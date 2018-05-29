const fs = require('fs');
const path = require('path');
const _ = require('lodash');
const results = JSON.parse(fs.readFileSync(path.join(__dirname, 'generated', 'results.json')).toString());
const runValues = ['user', 'rss'];
const runClass = ['run', 'type'];
const runClassOrders = {
  run: ['justInit', 'nonBatched', 'batched'],
  type: ['simple', 'mobx', 'carmi']
};

const maxItemLen = 25;
function printLine(line, prefix, fill = ' ') {
  console.log(`|${_.pad(prefix, maxItemLen, fill)}|${line.map(v => _.pad(v, maxItemLen, fill)).join('|')}|`);
}

Object.keys(results).forEach(testname => {
  const testResults = results[testname];
  const keys = Object.keys(testResults[0]);
  console.log(testResults.length);
  const grouped = _(testResults)
    .groupBy(run => runClass.map(key => run[key]).join(':'))
    .mapValues(runsOfType => {
      return runValues.reduce((acc, key) => {
        acc[key] =
          _(runsOfType)
            .map(key)
            .sum() / runsOfType.length;
        return acc;
      }, {});
    })
    .mapValues(({ user, rss }) => `${(user / 1000).toFixed(3)}ms ${(rss / 1000000).toFixed(3)}MB`)
    .value();
  console.log(grouped);
  const permCount = runClassOrders.run.length * runClassOrders.type.length;
  printLine(runClassOrders.type.map(v => '-'), '', '-');
  printLine(runClassOrders.type, '');
  printLine(runClassOrders.type.map(v => '-'), '', '-');
  const line = [];
  for (let perm = 0; perm < permCount; perm++) {
    const run = runClassOrders.run[Math.floor(perm / runClassOrders.type.length)];
    const type = runClassOrders.type[perm % runClassOrders.type.length];
    line.push(grouped[[run, type].join(':')]);
    if (line.length === runClassOrders.type.length) {
      printLine(line, run);
      line.length = 0;
    }
  }
  printLine(runClassOrders.type.map(v => '-'), '', '-');
});