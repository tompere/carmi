function base() {
  function $NAME($model, $funcLibRaw, $batchingStrategy) {
    let $funcLib = $funcLibRaw
    /* DEBUG */
    $funcLib = (!$funcLibRaw || typeof Proxy === 'undefined') ? $funcLibRaw : new Proxy($funcLibRaw, {
      get: (target, functionName) => {
        if (target[functionName]) {
          return target[functionName]
        }

        throw new TypeError(`Trying to call undefined function: ${functionName} `)
    }})

    function mathFunction(name, source) {
      return arg => {
        const type = typeof arg
        if (type !== 'number') {
          throw new TypeError(`Trying to call ${JSON.stringify(arg)}.${name}. Expects number, received ${type} at ${source}`)
        }

        return Math[name](arg)
      }
    }

    function stringFunction(name, source) {
      return function(...args) {
        const type = typeof this
        if (type !== 'string') {
          throw new TypeError(`Trying to call ${JSON.stringify(this)}.${name}. Expects string, received ${type} at ${source}`)
        }

        return String.prototype[name].call(this, ...args)
      }
    }

    function checkType(input, name, type, functionName, source) {
      if (typeof input === type) {
        return
      }

      const asString = typeof input === 'object' ? JSON.stringify(input) : input

      throw new TypeError(`${functionName} expects ${type}. ${name}: ${asString}.${functionName} at ${source}`)
    }

  /* DEBUG-END */

  const $res = { $model };
    const $listeners = new Set();
    const $topLevel = new Array($COUNT_GETTERS).fill(null);
    /* LIBRARY */
    /* ALL_EXPRESSIONS */
    let $inBatch = false;
    let $batchPending = [];
    let $inRecalculate = false;

    function recalculate() {
      if ($inBatch) {
        return;
      }
      $inRecalculate = true;
      /* DERIVED */
      /* RESET */
      $listeners.forEach(callback => callback());
      $inRecalculate = false;
      if ($batchPending.length) {
        $res.$endBatch();
      }
    }

    function $setter(func, ...args) {
      if ($inBatch || $inRecalculate || $batchingStrategy) {
        if ((!$inBatch && !$inRecalculate) && $batchingStrategy) {
          $batchingStrategy.call($res);
          $inBatch = true;
        }
        $batchPending.push({ func, args });
      } else {
        func.apply($res, args);
        recalculate();
      }
    }

    Object.assign(
      $res,
      {
        /* SETTERS */
      },
      {
        $startBatch: () => {
          $inBatch = true;
        },
        $endBatch: () => {
          $inBatch = false;
          if ($batchPending.length) {
            $batchPending.forEach(({ func, args }) => {
              func.apply($res, args);
            });
            $batchPending = [];
            recalculate();
          }
        },
        $runInBatch: func => {
          $res.$startBatch();
          func();
          $res.$endBatch();
        },
        $addListener: func => {
          $listeners.add(func);
        },
        $removeListener: func => {
          $listeners.delete(func);
        },
        $setBatchingStrategy: func => {
          $batchingStrategy = func;
        },
        /* DEBUG */
        $ast: () => {
          return $AST;
        },
        $source: () => {
          return /* SOURCE_FILES */;
        }
        /* DEBUG-END */
      }
    );
    recalculate();
    return $res;
  }
}

function func() {
  function $FUNCNAME(val, key, context) {
      return $EXPR1;
  }
}

function topLevel() {
  function $$FUNCNAME() {
    return $EXPR;
  }
}

function recursiveMap() {
  function $FUNCNAME(val, key, context, loop) {
      return $EXPR1;
  }
}

function helperFunc() {
  function $FUNCNAME($FN_ARGS) {
    return $EXPR1;
  }
}

function recursiveMapValues() {
  function $FUNCNAME(val, key, context, loop) {
    return $EXPR1;
  }
}

function library() {
  function mapValues(func, src, context) {
    return Object.keys(src).reduce((acc, key) => {
      acc[key] = func(src[key], key, context);
      return acc;
    }, {});
  }

  function filterBy(func, src, context) {
    return Object.keys(src).reduce((acc, key) => {
      if (func(src[key], key, context)) {
        acc[key] = src[key];
      }
      return acc;
    }, {});
  }

  function groupBy(func, src, context) {
    if (Array.isArray(src)) {
      throw new Error('groupBy only works on objects');
    }
    return Object.keys(src).reduce((acc, key) => {
      const newKey = func(src[key], key, context);
      acc[newKey] = acc[newKey] || {};
      acc[newKey][key] = src[key];
      return acc;
    }, {});
  }

  function mapKeys(func, src, context) {
    return Object.keys(src).reduce((acc, key) => {
      const newKey = func(src[key], key, context);
      acc[newKey] = src[key];
      return acc;
    }, {});
  }

  function map(func, src, context) {
    return src.map((val, key) => func(val, key, context));
  }

  function any(func, src, context) {
    /* ARRAY_CHECK */
    return src.some((val, key) => func(val, key, context));
  }

  function filter(func, src, context) {
    /* ARRAY_CHECK */
    return src.filter((val, key) => func(val, key, context));
  }

  function anyValues(func, src, context) {
    return Object.keys(src).some(key => func(src[key], key, context));
  }

  function keyBy(func, src, context) {
    return src.reduce((acc, val, key) => {
      acc[func(val, key, context)] = val;
      return acc;
    }, {});
  }

  function keys(src) {
    return Array.from(Object.keys(src));
  }

  function values(src) {
    return Array.from(Object.values(src));
  }

  function assign(src) {
    return Object.assign({}, ...src);
  }

  function size(src) {
    return Array.isArray(src) ? src.length : Object.keys(src).length;
  }

  function range(end, start = 0, step = 1) {
    const res = [];
    for (let val = start; (step > 0 && val < end) || (step < 0 && val > end); val += step) {
      res.push(val);
    }
    return res;
  }

  function defaults(src) {
    return Object.assign({}, ...[...src].reverse());
  }

  function loopFunction(resolved, res, func, src, context, key) {
    if (!resolved[key]) {
      resolved[key] = true;
      res[key] = func(src[key], key, context, loopFunction.bind(null, resolved, res, func, src, context));
    }
    return res[key];
  }

  function sum(src) {
    return src.reduce((sum, val) => sum + val, 0)
  }

  function recursiveMap(func, src, context) {
    const res = [];
    const resolved = src.map(x => false);
    src.forEach((val, key) => {
      loopFunction(resolved, res, func, src, context, key);
    });
    return res;
  }

  function recursiveMapValues(func, src, context) {
    const res = {};
    const resolved = {};
    Object.keys(src).forEach(key => (resolved[key] = false));
    Object.keys(src).forEach(key => {
      loopFunction(resolved, res, func, src, context, key);
    });
    return res;
  }
}

module.exports = { base, library, func, topLevel, helperFunc, recursiveMapValues, recursiveMap };
