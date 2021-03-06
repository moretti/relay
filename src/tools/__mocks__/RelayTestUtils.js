/**
 * Copyright 2013-2015, Facebook, Inc.
 * All rights reserved.
 *
 * This source code is licensed under the BSD-style license found in the
 * LICENSE file in the root directory of this source tree. An additional grant
 * of patent rights can be found in the PATENTS file in the same directory.
 */

'use strict';

/**
 * Utility methods (eg. for unmocking Relay internals) and custom Jasmine
 * matchers.
 */
var RelayTestUtils = {
  /**
   * Returns true if `query` contains a node that equals the `target` node
   */
  containsNode(query, target) {
    function find(node) {
      if (node.equals(target)) {
        return true;
      }
      var children = node.getChildren();
      return children.length > 0 && children.some(find);
    }
    return find(query);
  },

  createRenderer(container) {
    var React = require('React');
    var ReactDOM = require('ReactDOM');
    var RelayPropTypes = require('RelayPropTypes');
    var RelayRoute = require('RelayRoute');

    class ContextSetter {
      getChildContext() {
        return this.props.context;
      }
      render() {
        return this.props.render();
      }
    }
    ContextSetter.childContextTypes = {
      route: RelayPropTypes.QueryConfig.isRequired,
    };

    class MockPointer {
      constructor(dataID) {
        this.dataID = dataID;
      }
    }

    container = container || document.createElement('div');

    return {
      render(render, route) {
        route = route || RelayRoute.genMockInstance();

        var result;
        function ref(component) {
          result = component;
        }
        ReactDOM.render(
          <ContextSetter
            context={{route}}
            render={() => {
              var element = render(dataID => new MockPointer(dataID));
              var pointers = {};
              for (var propName in element.props) {
                var propValue = element.props[propName];
                if (propValue instanceof MockPointer) {
                  var fragmentReference = element.type.getFragment(propName);
                  if (fragmentReference == null) {
                    throw new Error(
                      'Query not found, `' + element.type.displayName + '.' +
                      propName + '`.'
                    );
                  }
                  pointers[propName] = RelayTestUtils.getPointer(
                    propValue.dataID,
                    RelayTestUtils.getNode(fragmentReference.getFragment({}))
                  );
                }
              }
              return React.cloneElement(element, {...pointers, ref});
            }}
          />,
          container
        );
        return result;
      }
    };
  },

  conditionOnType(fragment) {
    var GraphQL = require('GraphQL');
    var RelayFragmentReference = require('RelayFragmentReference');
    var invariant = require('invariant');

    invariant(
      GraphQL.isFragment(fragment),
      'conditionOnType(): Argument must be a GraphQL.QueryFragment.'
    );
    var reference = new RelayFragmentReference(
      () => fragment,
      {}
    );
    reference.conditionOnType();
    return reference;
  },

  defer(fragment) {
    var GraphQL = require('GraphQL');
    var RelayFragmentReference = require('RelayFragmentReference');
    var invariant = require('invariant');

    invariant(
      GraphQL.isFragment(fragment),
      'defer(): Argument must be a GraphQL.QueryFragment.'
    );
    var reference = new RelayFragmentReference(
      () => fragment,
      {}
    );
    reference.defer();
    return reference;
  },

  getNode(node, variables) {
    var RelayMetaRoute = require('RelayMetaRoute');
    var RelayQuery = require('RelayQuery');

    var route = RelayMetaRoute.get('$RelayTestUtils');
    variables = variables || {};
    return RelayQuery.Node.create(node, route, variables);
  },

  getPointer(dataID, fragment) {
    var GraphQLFragmentPointer = require('GraphQLFragmentPointer');
    var RelayQuery = require('RelayQuery');
    var invariant = require('invariant');

    invariant(
      fragment instanceof RelayQuery.Fragment,
      'getPointer(): expected a `RelayQueryFragment`, got `%s`.',
      fragment.constructor.name
    );

    var fragmentPointer = new GraphQLFragmentPointer(dataID, fragment);
    return {[fragment.getConcreteFragmentID()]: fragmentPointer};
  },

  /**
   * Convenience method for turning `node` into a properly formed ref query. We
   * can't produce one of these solely with `Relay.QL`, so we use a node from
   * `Relay.QL` as a basis and attach the appropriate args and ref params.
   */
  getRefNode(node, refParam) {
    var GraphQL = require('GraphQL');
    var RelayQuery = require('RelayQuery');
    var RelayMetaRoute = require('RelayMetaRoute');

    var invariant = require('invariant');

    invariant(
      node.fieldName === 'nodes',
     'getRefNode(): Ref queries require `nodes()` roots.'
    );
    var callValue = Array.isArray(node.calls[0].value) ?
      node.calls[0].value[0] :
      node.calls[0].value;
    invariant(
      GraphQL.isCallVariable(callValue),
      'getRefNode(): Expected a batch call variable, got `%s`.',
      JSON.stringify(callValue)
    );
    var name = callValue.callVariableName;
    var match = name.match(/^ref_(q\d+)$/);
    invariant(
      match,
      'getRefNode(): Expected call variable of the form `<ref_q\\d+>`.'
    );
    // e.g. `q0`
    var id = match[1];
    // e.g. `{ref_q0: '<ref_q0>'}`
    var variables = {[name]: '<' + callValue.callVariableName + '>'};

    return RelayQuery.Node.create(
      new GraphQL.Query(
        'nodes',
        new GraphQL.BatchCallVariable(id, refParam.path),
        node.fields,
        node.fragments,
        {isDeferred: true},
        null
      ),
      RelayMetaRoute.get('$RelayTestUtils'),
      variables
    );
  },

  getVerbatimNode(node) {
    return RelayTestUtils.filterGeneratedFields(RelayTestUtils.getNode(node));
  },

  filterGeneratedFields(query) {
    var RelayQuery = require('RelayQuery');
    var filterRelayQuery = require('filterRelayQuery');

    return filterRelayQuery(
      query,
      node => !(node instanceof RelayQuery.Field && node.isGenerated())
    );
  },

  matchers: {

    /**
     * Checks if a RelayQuery.Root is `===` to another.
     */
    toBeQueryRoot(expected) {
      var RelayQuery = require('RelayQuery');
      if (!checkQueryType.call(this, expected, RelayQuery.Root)) {
        return false;
      }
      return checkQueryEquality.call(this, expected, true);
    },

    /**
     * Checks that `warning` was invoked with a falsey condition with expected
     * arguments the supplied number of times. Example usage:
     *
     *   warning(false, "format", "x", "y");
     *   warning(false, "format", "x", "z");
     *
     *   expect(["format", "x", "y"]).toBeWarnedNTimes(1);
     *   expect(["format", "x", "z"]).toBeWarnedNTimes(1);
     *   expect(["format", "x"]).toBeWarnedNTimes(2);
     *
     *   warning(false, "format", "y");
     *
     *   expect(["format", "y"]).toBeWarnedNTimes(1);
     *
     *   warning(true, "format", "z");
     *
     *   expect(["format", "z"]).toBeWarnedNTimes(0);
     *
     *   expect(["format"]).toBeWarnedNTimes(3);
     *
     */
    toBeWarnedNTimes(expectedCount) {
      var warning = require('warning');
      if (!warning.mock) {
        throw new Error(
          'expect(...).toBeWarnedNTimes(): Requires `jest.mock(\'warning\');`.'
        );
      }
      var expectedArgs = this.actual;
      if (!Array.isArray(expectedArgs)) {
        throw new Error(
          'expect(...).toBeWarnedNTimes(): Requires an array of warning args.'
        );
      }
      var [format, ...values] = expectedArgs;
      if (!format) {
        throw new Error(
          'expect(...).toBeWarnedNTimes(): Requires a format string.'
        );
      }

      var callsWithExpectedFormatButArgs = [];
      var callsWithExpectedArgs = warning.mock.calls.filter(args => {
        if (args[0] ||
            args[1] !== format) {
          return false;
        }
        if (values.some((value, ii) => value !== args[ii + 2])) {
          callsWithExpectedFormatButArgs.push(args.slice(1));
          return false;
        }
        return true;
      });
      this.message = () => {
        var message =
          'Expected to warn ' + expectedCount + ' time' +
          (expectedCount === 1 ? '' : 's') + ' with arguments: ' +
          JSON.stringify(expectedArgs) + '.';
        var unexpectedCount = callsWithExpectedFormatButArgs.length;
        if (unexpectedCount) {
          message += ' Instead, called ' + unexpectedCount +
          ' time' + (unexpectedCount === 1 ? '' : 's') + ' with arguments: ' +
          JSON.stringify(callsWithExpectedFormatButArgs) + '.';
        }
        return message;
      };
      return callsWithExpectedArgs.length === expectedCount;
    },

    /**
     * Checks if a query node contains a node that `equals()` another.
     */
    toContainQueryNode(expected) {
      if (!RelayTestUtils.containsNode(this.actual, expected)) {
        this.message = () => {
          return printQueryComparison(
            this.actual,
            expected,
            'to contain query node'
          );
        };
        return false;
      }
      return true;
    },

    /**
     * Checks if a RelayQuery.Node is `equals()` to another.
     */
    toEqualQueryNode(expected) {
      var RelayQuery = require('RelayQuery');
      if (!checkQueryType.call(this, expected, RelayQuery.Node)) {
        return false;
      }
      return checkQueryEquality.call(this, expected, false);
    },

    /**
     * Checks if a RelayQuery.Root is `equals()` to another.
     */
    toEqualQueryRoot(expected) {
      var RelayQuery = require('RelayQuery');
      if (!checkQueryType.call(this, expected, RelayQuery.Root)) {
        return false;
      }
      return checkQueryEquality.call(this, expected, false);
    },

    toFailInvariant(expected) {
      this.env.currentSpec.expect(this.actual).toThrow(
        'Invariant Violation: ' + expected
      );
      return true;
    },

    /**
     * Compares a query path with another path. Succeeds when the paths are of
     * the same length have equivalent (shallow-equal) roots and fields.
     */
    toMatchPath(expected) {
      var GraphQL = require('GraphQL');
      var RelayMetaRoute = require('RelayMetaRoute');
      var RelayQuery = require('RelayQuery');
      var RelayQueryPath = require('RelayQueryPath');

      var invariant = require('invariant');
      var flattenRelayQuery = require('flattenRelayQuery');
      var printRelayQuery = require('printRelayQuery');

      invariant(
        expected && expected instanceof RelayQueryPath,
        'expect(...).toMatchPath(): Argument must be a RelayQueryPath.'
      );
      if (!(this.actual instanceof RelayQueryPath)) {
        this.message = () => {
          var name = this.actual ? this.actual.constructor.name : this.actual;
          return `expected instance of RelayQueryPath but got [${name}]`;
        };
        return false;
      }
      var fragment = RelayQuery.Node.create(
        new GraphQL.QueryFragment('Test', 'Node', [
          new GraphQL.Field('__test__')
        ]),
        RelayMetaRoute.get('$RelayTestUtils'),
        {}
      );
      var actualQuery = flattenRelayQuery(this.actual.getQuery(fragment));
      var expectedQuery = flattenRelayQuery(expected.getQuery(fragment));

      if (!actualQuery.equals(expectedQuery)) {
        this.message = () => [
          'Expected:',
          '  ' + printRelayQuery(actualQuery),
          '\ntoMatchPath:',
          '  ' + printRelayQuery(expectedQuery),
        ].filter(token => token).join('\n');

        return false;
      }
      return true;
    },

    /**
     * Compares a JSON object of RelayQuery with a JSON object. Succeeds when
     * when the objects match.
     */
    toMatchQueryJSON(expected) {
      var matchQueryJSON = (actual, expected, path) =>  {
        if (typeof actual !== 'object') {
          if (actual === expected) {
            return true;
          } else {
            this.message = () => {
              return 'Expected ' + path.join('.') + ' to be ' + expected +
                ', but got ' + actual;
            };
            return false;
          }
        }
        for (var key in actual) {
          // Skip extra fields in actual that is under metadata.
          if (expected.hasOwnProperty(key) !== actual.hasOwnProperty(key) &&
              (path.length == 0 || path[path.length-1] !== 'metadata')) {
            this.message = () => {
              return 'Expected ' + path.join('.') + ' to not have key: ' +
                key;
            };
            return false;
          }
        }
        for (var k in expected) {
          if (expected.hasOwnProperty(k) !== actual.hasOwnProperty(k)) {
            if (path.length > 0 && path[path.length-1] === 'metadata') {
              continue;
            }
            this.message = () => {
              return 'Expected ' + path.join('.') + ' to have key: ' + k;
            };
            return false;
          }
          var value = expected[k];
          var result;
          if (Array.isArray(value)) {
            for (var jj = 0; jj < value.length; jj++) {
              path.push(k + '[' + jj + ']');
              result = matchQueryJSON(actual[k][jj], value[jj], path);
            }
          } else {
            path.push(k);
            result = matchQueryJSON(actual[k], expected[k], path);
          }
          if (result) {
            path.pop();
          } else {
            return result;
          }
        }
        return true;
      };
      return matchQueryJSON(this.actual, expected, []);
    }
  },

  unmockRelay() {
    jest
      // Utilities
      .dontMock('areEqual')

      // Legacy modules
      .dontMock('GraphQL')
      .dontMock('GraphQLMutatorConstants')
      .dontMock('GraphQLStoreDataHandler')
      .dontMock('GraphQLStoreRangeUtils')
      .dontMock('generateClientEdgeID');
  },

  /**
   * Helper to write the result payload of a (root) query into a store,
   * returning created/updated ID sets.
   */
  writePayload(store, query, payload, tracker, options) {
    var RelayChangeTracker = require('RelayChangeTracker');
    var RelayQueryTracker = require('RelayQueryTracker');
    var RelayQueryWriter = require('RelayQueryWriter');
    var writeRelayQueryPayload = require('writeRelayQueryPayload');

    tracker = tracker || new RelayQueryTracker();
    options = options || {};
    var changeTracker = new RelayChangeTracker();
    var writer = new RelayQueryWriter(
      store,
      tracker,
      changeTracker,
      options
    );
    writeRelayQueryPayload(
      writer,
      query,
      payload,
    );
    return changeTracker.getChangeSet();
  },
};

/**
 * @private
 */
function checkQueryType(expected, ExpectedClass) {
  var expectedType = ExpectedClass.name;
  if (!(expected && expected instanceof ExpectedClass)) {
    throw new Error('expect(...): Requires a `' + expectedType + '`.');
  }
  if (!(this.actual instanceof ExpectedClass)) {
    this.message = () => {
      var actualType = this.actual;
      if (this.actual && this.actual.constructor) {
        actualType = this.actual.constructor.name;
      }
      return 'Expected a `' + expectedType + '`, got `' + actualType + '`.';
    };
    return false;
  }
  return true;
}

/**
 * @private
 */
function checkQueryEquality(expected, toBe) {
  var flatActual = sortRelayQuery(this.actual);
  var flatExpected = sortRelayQuery(expected);

  if (toBe ? (this.actual !== expected) : (!flatActual.equals(flatExpected))) {
    this.message = () => {
      return printQueryComparison(
        this.actual,
        expected,
        toBe ? 'to be query' : 'to equal query'
      );
    };
    return false;
  }

  return true;
}

/**
 * @private
 */
function printQueryComparison(actual, expected, message) {
  var printRelayQuery = require('printRelayQuery');

  var formatRefParam = node => node.hasRefParam && node.hasRefParam() ?
      '  [ref param: ' + JSON.stringify(node.getRefParam()) + ']' :
      null;

  return [
    'Expected:',
    '  ' + printRelayQuery(actual),
    formatRefParam(actual),
    message + ':',
    '  ' + printRelayQuery(expected),
    formatRefParam(expected),
  ].filter(line => !!line).join('\n');
}

/**
 * @private
 */
function sortRelayQuery(node) {
  var RelayQuery = require('RelayQuery');

  function getID(node) {
    return node instanceof RelayQuery.Fragment ?
      node.getFragmentID() :
      node.getSerializationKey();
  }
  function compare(a, b) {
    if (a === b) {
      return 0;
    } else if (a < b) {
      return -1;
    } else {
      return 1;
    }
  }

  return node.clone(node.getChildren().sort((a, b) => {
    var aID = getID(a);
    var bID = getID(b);
    return compare(aID, bID);
  }).map(sortRelayQuery));
}

module.exports = RelayTestUtils;
