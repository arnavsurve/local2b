import { expect, spyOn, test } from 'bun:test';
import type { Credentials, RepoSpec, StartOpts } from '../providers/types';
import { writeFileSync } from 'node:fs';
import { statePath } from '../state';
import { fakeMachineHost } from '../test/fake-machine';
import { snapshotName } from './layout';
import { machineWorkflow } from './workflow';

const credentials: Credentials = { variables: {}, git: null };

const repo: RepoSpec = {
  owner: 'o',
  name: 'widgets',
  remoteUrl: 'https://github.com/o/widgets.git',
  baseBranch: null,
  clone: { strategy: 'plain', depth: 50, filter: null },
  setup: [],
  install: null,
  warm: null,
  env: {},
};

let n = 0;
const startOpts = ({ image }: { image: string | null }): StartOpts => ({
  name: `box-${++n}`,
  repo: null,
  branch: null,
  source: 'bake',
  image,
  idle: { minutes: 15 },
  credentials,
  gitIdentity: null,
});

function setup() {
  const fake = fakeMachineHost({ id: 'fake', execExitCode: 0, homeDir: '/home/user', failure: null });
  return { ...fake, workflow: machineWorkflow({ host: fake.provider }) };
}

async function stderrOf(task: () => Promise<unknown>) {
  const lines: string[] = [];
  const err = spyOn(console, 'error').mockImplementation((line: unknown) => {
    lines.push(String(line));
  });
  const log = spyOn(console, 'log').mockImplementation(() => {});
  try {
    await task();
  } finally {
    err.mockRestore();
    log.mockRestore();
  }
  return lines.join('\n');
}

test('a start on a host without the base image builds it first, once', async () => {
  const { workflow, image, alive } = setup();
  image.built = false;
  const said = await stderrOf(() => workflow.start(startOpts({ image: null })));
  expect(said).toContain('preparing the base image fake-image (first use; several minutes, once)');
  expect(image.builds).toBe(1);
  expect(alive.size).toBe(1);
  await stderrOf(() => workflow.start(startOpts({ image: null })));
  expect(image.builds).toBe(1);
});

test('a changed image recipe rebuilds the base image before the next start or bake', async () => {
  const { workflow, image } = setup();
  image.built = false;
  await stderrOf(() => workflow.start(startOpts({ image: null })));
  image.recipe = 'recipe-2';
  const said = await stderrOf(() => workflow.bake({ repo, credentials, image: null }));
  expect(said).toContain('preparing the base image fake-image (image settings changed; several minutes, once)');
  expect(image.builds).toBe(2);
  await stderrOf(() => workflow.bake({ repo, credentials, image: null }));
  expect(image.builds).toBe(2);
});

test('an existing image with no local record is used as it is, and its recipe recorded', async () => {
  const { workflow, image } = setup();
  const said = await stderrOf(() => workflow.start(startOpts({ image: null })));
  expect(said).toContain('using the existing base image fake-image');
  expect(image.builds).toBe(0);
  image.recipe = 'recipe-2';
  await stderrOf(() => workflow.start(startOpts({ image: null })));
  expect(image.builds).toBe(1);
});

test('a base image deleted on the host is built again', async () => {
  const { workflow, image } = setup();
  await stderrOf(() => workflow.start(startOpts({ image: null })));
  image.built = false;
  await stderrOf(() => workflow.start(startOpts({ image: null })));
  expect(image.builds).toBe(1);
});

test('a start with its own image never builds the base image', async () => {
  const { workflow, image } = setup();
  image.built = false;
  await stderrOf(() => workflow.start(startOpts({ image: 'custom' })));
  expect(image.builds).toBe(0);
});

test('prepare builds the base image and records its recipe', async () => {
  const { workflow, image } = setup();
  expect(await workflow.prepare()).toBe('built image fake-image@1');
  expect(await stderrOf(() => workflow.start(startOpts({ image: null })))).not.toContain('base image');
  expect(image.builds).toBe(1);
});

test('a bake made on an older base image has no age, so it is made again', async () => {
  const { workflow, image } = setup();
  await stderrOf(() => workflow.bake({ repo, credentials, image: null }));
  expect(await workflow.bakedAt({ repo })).not.toBeNull();
  image.recipe = 'recipe-2';
  expect(await workflow.bakedAt({ repo })).toBeNull();
  await stderrOf(() => workflow.bake({ repo, credentials, image: null }));
  expect(await workflow.bakedAt({ repo })).not.toBeNull();
  expect(image.builds).toBe(1);
});

test('starts racing on a missing image build it once, even on a host that lists an image while it builds', async () => {
  const { workflow, image, alive } = setup();
  image.built = false;
  image.listedWhileBuilding = true;
  const said = await stderrOf(() => Promise.all([workflow.start(startOpts({ image: null })), Bun.sleep(5).then(() => workflow.start(startOpts({ image: null })))]));
  expect(image.builds).toBe(1);
  expect(alive.size).toBe(2);
  expect(said).not.toContain('using the existing base image');
});

test('a bake right after a rebuild comes from the new build, even while the image name still serves the old one', async () => {
  const { workflow, image, bakedFrom } = setup();
  await stderrOf(() => workflow.start(startOpts({ image: null })));
  image.recipe = 'recipe-2';
  image.nameLags = true;
  await stderrOf(() => workflow.bake({ repo, credentials, image: null }));
  expect(image.builds).toBe(1);
  expect(bakedFrom.get(snapshotName('o/widgets'))).toBe('fake-image@1');
});

test('a start without a bake comes from the build the base image was last prepared as', async () => {
  const { workflow, image, startedFrom } = setup();
  await stderrOf(() => workflow.start(startOpts({ image: null })));
  image.recipe = 'recipe-2';
  image.nameLags = true;
  const said = await stderrOf(() => workflow.start(startOpts({ image: null })));
  expect(said).toContain('image settings changed');
  expect([...startedFrom.values()]).toEqual(['fake-image@0', 'fake-image@1']);
});

test('a bake made on another build of the base image has no age, so the next start re-bakes it', async () => {
  const { workflow, bakedFrom } = setup();
  await stderrOf(() => workflow.bake({ repo, credentials, image: null }));
  expect(bakedFrom.get(snapshotName('o/widgets'))).toBe('fake-image@0');
  expect(await workflow.bakedAt({ repo })).not.toBeNull();
  await stderrOf(() => workflow.prepare());
  expect(await workflow.bakedAt({ repo })).toBeNull();
  await stderrOf(() => workflow.bake({ repo, credentials, image: null }));
  expect(bakedFrom.get(snapshotName('o/widgets'))).toBe('fake-image@1');
  expect(await workflow.bakedAt({ repo })).not.toBeNull();
});

test('a bake recorded before l2b noted its base build has no age, so it is made once more', async () => {
  const { workflow } = setup();
  await stderrOf(() => workflow.bake({ repo, credentials, image: null }));
  writeFileSync(statePath('bakes.json'), JSON.stringify({ 'fake:o/widgets': new Date().toISOString() }));
  expect(await workflow.bakedAt({ repo })).toBeNull();
  await stderrOf(() => workflow.bake({ repo, credentials, image: null }));
  expect(await workflow.bakedAt({ repo })).not.toBeNull();
});

test('a bake made from its own image is not judged by the base image builds', async () => {
  const { workflow, bakedFrom } = setup();
  await stderrOf(() => workflow.bake({ repo, credentials, image: 'custom' }));
  expect(bakedFrom.get(snapshotName('o/widgets'))).toBe('custom');
  await stderrOf(() => workflow.prepare());
  expect(await workflow.bakedAt({ repo })).not.toBeNull();
});
