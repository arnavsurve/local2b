import { requirePositional } from '../args';
import type { Command } from '../context';
import { connectBox } from '../find-box';
import { COMMAND_HELP } from '../help';
import { decodeText, putLocalFile } from '../put';

export const put: Command = async ({ ctx, args }) => {
  const usage = COMMAND_HELP.put.usage;
  const name = requirePositional({ positionals: args, index: 0, usage });
  const local = requirePositional({ positionals: args, index: 1, usage });
  const remote = requirePositional({ positionals: args, index: 2, usage });
  const box = await connectBox({ ctx, name });
  const path =
    local === '-'
      ? await box.put({
          path: remote,
          content: decodeText({ bytes: new Uint8Array(await Bun.stdin.arrayBuffer()), what: 'stdin' }),
          executable: false,
        })
      : await putLocalFile({ box, localPath: local, remote });
  console.log(path);
};
