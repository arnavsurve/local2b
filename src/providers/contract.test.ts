import { describeProviderContract } from './contract';
import { fakeContractSubject } from '../test/fake-provider';

describeProviderContract({ name: 'fake', makeProvider: fakeContractSubject, timeoutMs: 30_000 });
