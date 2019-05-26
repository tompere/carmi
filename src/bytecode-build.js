/* eslint-disable prefer-const */
const {TokenTypeData, Token, Expr} = require('./lang');
const NaiveCompiler = require('./naive-compiler');
const _ = require('lodash');
const fs = require('fs');
const path = require('path');

const babelParser = require('@babel/parser');
const walk = require('babylon-walk');
const generate = require('babel-generator');
const optLibrary = require('./templates/optimizing').library.toString();

const verbs = Object.keys(TokenTypeData)
  .filter(token => !TokenTypeData[token].nonVerb)
  .filter(token => token !== 'abstract')
  .filter(token => token !== 'cond');
const lazyVerbs = new Set(['and', 'or', 'ternary']);
const eagerVerbs = verbs.filter(token => !lazyVerbs.has(token));
const verbsLazyFirst = Array.from(lazyVerbs).concat(Array.from(lazyVerbs).map(t => `${t}Tracked`), eagerVerbs);
const verbsSet = new Set(verbsLazyFirst);
const nonVerbs = Object.keys(TokenTypeData).filter(token => TokenTypeData[token].nonVerb);

const valueTypes = ['numberInline', 'booleanInline', 'stringRef', 'numberRef', 'expressionRef', 'condRef'];

const setterTypes = ['setter', 'splice', 'push'];

const defineEnum = (name, values) => `
${values.map((key, index) => `module.exports.$${key} = ${index};`).join('\n')}
module.exports.${name}Count = ${values.length};
module.exports.${name} = {
${values.map((key, index) => `  $${key}: ${index}`).join(',\n')}
};

`;

const enums = `
${defineEnum('Verbs', verbsLazyFirst)}
${defineEnum('nonVerbs', valueTypes.concat(nonVerbs))}
${defineEnum('setterTypes', setterTypes)}

// Values are uint32
// VVVVVVVVVVVVVVVVVVVVVVVVVVVVVTTT
// TTT - signifies type
// 000 - number inline
// 001 - boolean inline
// 010 - string ref
// 011 - number ref
// 100 - token
// 101 - expression ref
// the rest of the bits are the value 2^29 possible values

// table Expression {
//     token: Verbs;
//     values: [uint32] (required);
// }

// table Bytecode {
//     topLevels:[uint32] (required);
//     topLevelsNames:[uint32] (required);
//     expressions: [Expression] (required);
//     constant_numbers:[float64] (required);
//     constant_strings:[string] (required);
// }

// root_type Bytecode;
// 

`;
fs.writeFileSync(path.join(__dirname, '..', 'bytecode', 'bytecode-enums.js'), enums);

const verbsNotAutoGenerated = new Set(['recur', 'func', 'array', 'object', 'recursiveMapValues', 'recursiveMap']);

const naiveCompiler = new NaiveCompiler({}, {});
const helperFunctions = eagerVerbs
  .map(verb => {
    if (
      verbsNotAutoGenerated.has(verb) ||
      TokenTypeData[verb].len[0] !== TokenTypeData[verb].len[1] ||
      TokenTypeData[verb].collectionVerb
    ) {
      return `// ${verb} skipped`;
    }
    const args = new Array(TokenTypeData[verb].len[0] - 1).fill().map((_, i) => new Token(`arg${i}`));
    const expr = Expr(new Token(verb), ...args);
    return `
module.exports.$${verb} = function $${verb}($offset, $len) {
${args
  .map(naiveCompiler.generateExpr)
  .map(
    (id, index) =>
      ` this.processValue(this.$expressions[++$offset])
  const ${id} = this.$stack.pop();`
  )
  .join('\n')}
    this.$stack.push(${naiveCompiler.generateExpr(expr)});
}`;
  })
  .join('\n');

const ast = babelParser.parse(optLibrary, {plugins: []});
const statements = ast.program.body[0].body.body;
const functions = statements.filter(t => t.type === 'FunctionDeclaration');
const functionNames = new Set(functions.map(t => t.id.name));
const constFuncs = statements
  .filter(t => t.type === 'VariableDeclaration')
  .filter(t => t.declarations[0].init.type === 'ArrowFunctionExpression');

const constFuncsNames = new Set(constFuncs.map(t => t.declarations[0].id.name));

const constFuncSources = Array.from(constFuncs)
  .filter(f => f.declarations[0].id.name !== 'recursiveCacheFunc')
  .map(f => generate.default(f).code)
  .join('\n');

const constValues = statements
  .filter(t => t.type === 'VariableDeclaration')
  .filter(t => t.declarations[0].init.type !== 'ArrowFunctionExpression');

const constValuesNames = new Set(
  constValues.map(t => t.declarations[0].id.name).concat(['$res', '$funcLib', '$funcLibRaw'])
);

function rewriteAncestorBlockStatement(ancestors, deleteCount, ...newItems) {
  const innerMostBlockStatementIndex = _.findLastIndex(ancestors, {type: 'BlockStatement'});
  const block = ancestors[innerMostBlockStatementIndex];
  const currentIndex = _.findIndex(block.body, ancestors[innerMostBlockStatementIndex + 1]);
  if (deleteCount > 0 && newItems.length) {
    ancestors[innerMostBlockStatementIndex + 1] = newItems[0];
  }
  return block.body.splice(currentIndex, deleteCount, ...newItems);
}

const visitorFuncDeclStatements = {
  ReturnStatement(node, state, ancestors) {
    if (ancestors.length > 3) {
      return;
    }
    Object.assign(node, {
      arguments: [node.argument],
      type: 'CallExpression',
      callee: {
        type: 'MemberExpression',
        object: {
          type: 'MemberExpression',
          object: {
            type: 'ThisExpression'
          },
          property: {
            type: 'Identifier',
            name: '$stack'
          },
          computed: false
        },
        property: {
          type: 'Identifier',
          name: 'push'
        },
        computed: false
      }
    });
    delete node.argument;
  },
  CallExpression(node, state, ancestors) {
    if (node.callee.name === 'getEmptyArray' || node.callee.name === 'getEmptyObject') {
      node.arguments = [
        {
          type: 'UnaryExpression',
          operator: '-',
          prefix: true,
          argument: {
            type: 'Identifier',
            name: '$offset'
          }
        }
      ];
    } else if (node.callee.name === 'initOutput') {
      const hasCache = node.arguments[4].name !== 'nullFunc';
      node.arguments.splice(0, 2);
      node.arguments[0] = {
        type: 'BinaryExpression',
        left: {
          type: 'Identifier',
          name: '$offset'
        },
        operator: '-',
        right: {
          type: 'Identifier',
          name: '$length'
        }
      };
    } else if (node.callee.name === 'func') {
      const arg = node.arguments[1];
      node.callee = {
        type: 'MemberExpression',
        object: {
          type: 'MemberExpression',
          object: {
            type: 'ThisExpression'
          },
          property: {
            type: 'Identifier',
            name: '$stack'
          },
          computed: false
        },
        property: {
          type: 'Identifier',
          name: 'pop'
        },
        computed: false
      };
      node.arguments = [];
      rewriteAncestorBlockStatement(
        ancestors,
        0,
        {
          type: 'ExpressionStatement',
          expression: {
            type: 'CallExpression',
            callee: {
              type: 'MemberExpression',
              object: {
                type: 'MemberExpression',
                object: {
                  type: 'ThisExpression'
                },
                property: {
                  type: 'Identifier',
                  name: '$keys'
                },
                computed: false
              },
              property: {
                type: 'Identifier',
                name: 'push'
              },
              computed: false
            },
            arguments: [arg]
          }
        },
        {
          type: 'ExpressionStatement',
          expression: {
            type: 'CallExpression',
            callee: {
              type: 'MemberExpression',
              object: {
                type: 'ThisExpression'
              },
              property: {
                type: 'Identifier',

                name: 'collectionFunction'
              },
              computed: false
            },
            arguments: []
          }
        }
      );
    }
    // c(node.callee);
    // node.arguments.forEach(c);
  }
};

const visitorsPointFunctionsToThis = {
  Identifier(node, state, ancestors) {
    if (
      constValuesNames.has(node.name) &&
      (ancestors[ancestors.length - 2].type !== 'MemberExpression' ||
        ancestors[ancestors.length - 2].object.type !== 'ThisExpression')
    ) {
      Object.assign(node, {
        type: 'MemberExpression',
        object: {
          type: 'ThisExpression'
        },
        property: {
          type: 'Identifier',
          name: node.name
        },
        computed: false
      });
      delete node.name;
    }
  },
  CallExpression(node, state, ancestors) {
    if (
      node.callee.name &&
      functionNames.has(node.callee.name) &&
      (ancestors[ancestors.length - 2].type !== 'MemberExpression' ||
        ancestors[ancestors.length - 2].object.type !== 'ThisExpression')
    ) {
      node.callee = {
        type: 'MemberExpression',
        object: {
          type: 'ThisExpression'
        },
        property: {
          type: 'Identifier',
          name: node.callee.name
        },
        computed: false
      };
    }
  }
};

const functionsById = functions.reduce((acc, f) => ({...acc, [f.id.name]: f}), {});
const verbFunctions = Object.keys(functionsById).reduce((acc, name) => {
  if (verbsSet.has(name) || verbsSet.has(name.replace('Opt', ''))) {
    return {...acc, [verbsSet.has(name) ? name : name.replace('Opt', '')]: functionsById[name]};
  }
  return acc;
}, {});

const verbsIgnoredInOptimizing = new Set(['recur', 'func', 'recursiveMapValues', 'recursiveMap']);

const snippets = _.mapValues(
  {
    srcPre: ($offset, $length) => {
      this.processValue(this.$expressions[++$offset]);
    },
    src: ($offset, $length) => {
      let src = this.$stack.pop();
      this.$collections.push(src);
    },
    srcEnd: ($offset, $length) => {
      this.$collections.pop();
      this.$currentSets.pop();
    },
    contextPre: ($offset, $length) => {
      if ($length === 3) {
        this.$stack.push(null);
      } else {
        this.processValue(this.$expressions[++$offset]);
      }
    },
    context: ($offset, $length) => {
      if ($length === 3) {
        this.$contexts.push(this.$stack.pop());
      } else {
        const contextArray = this.getEmptyArray(~$offset);
        if (contextArray.length) {
          this.setOnArray(contextArray, 0, this.$stack.pop(), false);
        } else {
          contextArray[0] = this.$stack.pop();
        }
        this.$contexts.push(contextArray);
      }
    },
    contextEnd: ($offset, $length) => {
      this.$contexts.pop();
    },
    func: ($offset, $length) => {
      // eslint-disable-next-line no-undef
      this.$functions.push(func);
    },
    funcPre: ($offset, $length) => {
      const func = this.$expressions[++$offset];
    },
    funcEnd: ($offset, $length) => {
      this.$functions.pop();
    },
    endPre: ($offset, $length) => {
      this.processValue(this.$expressions[++$offset]);
    },
    end: ($offset, $length) => {
      const end = this.$stack.pop();
    },
    startPre: ($offset, $length) => {
      if ($length > 2) {
        this.processValue(this.$expressions[++$offset]);
      } else {
        this.$stack.push(0);
      }
    }, 
    start: ($offset, $length) => {
      const start = this.$stack.pop();
    },
    stepPre: ($offset, $length) => {
      if ($length > 3) {
        this.processValue(this.$expressions[++$offset]);
      } else {
        this.$stack.push(1);
      }
    },
    step: ($offset, $length) => {
      const step = this.$stack.pop();
    },
    len: ($offset, $length) => {
      const len = $length - 1;
    },
    newValPre: ($offset, $length) => {
      const newVal = [];
      for (let i = 1; i < $length; i++) {
        this.processValue(this.$expressions[++$offset]);
        newVal.push(this.$stack.pop());
      }
    },
    keysListPre: ($offset, $length) => {
      let keysList = this.$globals.get($offset);
      if (!keysList) {
        keysList = [];
        for (let i = 1; i < $length; i += 2) {
          this.processValue(this.$expressions[$offset + i]);
          keysList.push(this.$stack.pop());
        }
        this.$globals.set($offset, keysList);
      }
    },
    valsListPre: ($offset, $length) => {
      const valsList = [];
      for (let i = 2; i < $length; i += 2) {
        this.processValue(this.$expressions[$offset + i]);
        valsList.push(this.$stack.pop());
      }
    }
  },
  f => {
    const snippetAst = babelParser.parse(f.toString(), {plugins: []});
    return snippetAst.program.body[0].expression.body.body;
  }
);

const extractedFuncs = Object.entries(verbFunctions)
  .map(([name, f]) => {
    if (verbsIgnoredInOptimizing.has(name)) {
      return `// ${name} skipped from optimizing`;
    }
    f.id.name = name;
    const paramsPre = _.flatten(
      f.params
        .map(t => `${t.name}Pre`)
        .map(t => snippets[t])
        .filter(Boolean)
    );
    const params = _.flatten(
      _.reverse(f.params
        .map(t => t.name)
        .map(t => snippets[t])
        .filter(Boolean)
        )
    );
    const paramEnds = _.flatten(
      f.params
        .map(t => `${t.name}End`)
        .map(t => snippets[t])
        .filter(Boolean)
    );
    walk.ancestor(f, visitorFuncDeclStatements, []);
    walk.ancestor(f, visitorsPointFunctionsToThis, []);
    f.body.body.splice(0, 0, ...paramsPre, ...params);
    f.body.body.push(...paramEnds);

    // console.log('func', name, JSON.stringify(f, null, 2));
    f.params = [
      {
        type: 'Identifier',
        name: '$offset'
      },
      {
        type: 'Identifier',
        name: '$length'
      }
    ];
    f = {
      type: 'ExpressionStatement',
      expression: {
        type: 'AssignmentExpression',
        operator: '=',
        left: {
          type: 'MemberExpression',
          object: {
            type: 'MemberExpression',
            object: {
              type: 'Identifier',
              name: 'module'
            },
            property: {
              type: 'Identifier',
              name: 'exports'
            },
            computed: false
          },
          property: {
            type: 'Identifier',
            name: `$${name}`
          },
          computed: false
        },
        right: f
      }
    };
    return generate.default(f).code;
  })
  .join('\n');


const keepNonVerbFunctions = ['untrack', 'invalidate', 'setOnObject', 'deleteOnObject', 'setOnArray', 'truncateArray', 'track', 'trackPath', 'triggerInvalidations', 'initOutput', 'getEmptyArray', 'getEmptyObject', 'invalidatePath', 'set', 'splice']
const nonVerbFunctions = keepNonVerbFunctions
  .map(name => functionsById[name])
  .map(f => {
    walk.ancestor(f, visitorsPointFunctionsToThis, []);
    return generate.default(f).code.replace(/^function /, '');
  });

fs.writeFileSync(
  path.join(__dirname, '..', 'bytecode', 'bytecode-functions.js'),
  `
${helperFunctions}
${constFuncSources}
${extractedFuncs}

/*
// constantValues
${constValues
  .map(
    t =>
      generate.default({
        type: 'ExpressionStatement',
        expression: {
          type: 'AssignmentExpression',
          operator: '=',
          left: {
            type: 'MemberExpression',
            object: {
              type: 'ThisExpression'
            },
            property: {
              type: 'Identifier',
              name: t.declarations[0].id.name
            },
            computed: false
          },
          right: t.declarations[0].init
        }
      }).code
  )
  .join('\n')}
${nonVerbFunctions.join('\n')}
*/

`
);
