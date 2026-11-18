const path = require('node:path');
const { subtask } = require('hardhat/config');
const { TASK_COMPILE_SOLIDITY_GET_SOLC_BUILD } = require('hardhat/builtin-tasks/task-names');

// Reuse the verified local compiler, including when working offline.
subtask(TASK_COMPILE_SOLIDITY_GET_SOLC_BUILD).setAction(async ({ solcVersion }) => {
  if (solcVersion !== '0.8.28') throw new Error('Only Solidity 0.8.28 is configured.');
  return {
    compilerPath: path.resolve(__dirname, '../.tools/solc-0.8.28'),
    isSolcJs: false,
    version: '0.8.28',
    longVersion: '0.8.28+commit.7893614a',
  };
});

module.exports = {
  solidity: '0.8.28',
  networks: {
    hardhat: { chainId: 31337 },
    localhost: { url: 'http://127.0.0.1:8545', chainId: 31337 },
  },
};
