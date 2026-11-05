import { Template } from 'e2b';
import { aptPackageList, rootCommands, type Feature } from '../../toolkit/recipe';

/**
 * Tooling-only image. It holds no repo and no credentials, so it is safe to
 * build once and share. Repo data is layered on afterwards by `l2b bake`.
 */
export function devTemplate({
  features,
  nodeMajor,
  npmGlobals,
  aptPackages,
  imageCommands,
}: {
  features: Feature[];
  nodeMajor: number;
  npmGlobals: string[];
  aptPackages: string[];
  imageCommands: string[];
}) {
  return Template()
    .fromUbuntuImage('24.04')
    .setUser('root')
    .aptInstall(aptPackageList({ features, extra: aptPackages }))
    .runCmd(rootCommands({ features, nodeMajor, npmGlobals }))
    .setUser('user')
    .setWorkdir('/home/user')
    .runCmd(imageCommands.length ? imageCommands : ['true']);
}
