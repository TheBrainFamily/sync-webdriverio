// A wrapped webdriverio with synchronous API using fibers.

var webdriverio = require('webdriverio');
var getImplementedCommands = require('webdriverio/build/lib/helpers/getImplementedCommands');
var _ = require('underscore');
var fs = require('fs');
var Fiber = require('fibers');
var Promise = global.Promise;
require('meteor-promise').makeCompatible(Promise, Fiber);
var wrapAsync = require('xolvio-fiber-utils').wrapAsync;
var wrapCommand = require('wdio-sync').wrapCommand;
var wrapAsyncObject = require('xolvio-fiber-utils').wrapAsyncObject;

var wrapAsyncForWebdriver = function (fn, context) {
  if (!global.browser) {
    global.browser = { options: { sync: true } };
  }
  else if (!global.browser.options) {
    global.browser.options = { sync: true };
  }
  return wrapCommand(fn.bind(context), fn.name, _.noop, _.noop);
};

var webdriverioWithSync = _.clone(webdriverio);

var wws = _.extend(webdriverioWithSync, {
  wrapAsync: wrapAsync,
  wrapAsyncObject: wrapAsyncObject,
  index: 0,
  _instances: [],
  _wrappers: [],
  _remote: {},
  _syncByDefault: true,
  remoteWrapper: {}
});

webdriverioWithSync.multiremote = function (options) {
  var _mainRemoteWrapper;
  wws.remote = webdriverio.multiremote.apply(webdriverio, arguments);

  webdriverioWithSync.wrapAsyncBrowser(wws.remote, options);

  Object.keys(options).forEach(function(browserName) {
    var browser = wws.remote.select(browserName);
    webdriverioWithSync.wrapAsyncBrowser(browser, options);
  });

  _mainRemoteWrapper = _.first(wws._wrappers);

  _mainRemoteWrapper.instances = [];
  wws._wrappers.forEach(function(wrapper, index) {
    // if one of the multiremote instances, first one is the "shared" one
    if (index > 0) {
      _mainRemoteWrapper.instances.push(wrapper);
    }
  });

  return _mainRemoteWrapper;
};

webdriverioWithSync.remote = function (options) {
  wws.remote = webdriverio.remote.apply(webdriverio, arguments);

  webdriverioWithSync.wrapAsyncBrowser(wws.remote, options);

  return _.first(wws._wrappers);
};

webdriverioWithSync.wrapAsyncBrowser = function(remote, options) {
  var syncByDefault = !(options && options.sync === false);

  var commandNames = _.keys(getImplementedCommands());

  var remoteWrapper;

  var waitUntil = remote.waitUntil;

  remote.waitUntil = function (condition/*, arguments */) {
    var args = _.toArray(arguments);
    args[0] = Promise.async(condition.bind(remoteWrapper), true);

    return waitUntil.apply(remote, args);
  };

  wws._instances.push(remote);
  wws._instances[wws.index].index = wws.index;

  wws._wrappers.push(wrapAsyncObject(remote, commandNames, {
    syncByDefault: syncByDefault,
    wrapAsync: wrapAsyncForWebdriver
  }));

  remoteWrapper = _.last(wws._wrappers);


  // Wrap async added commands
  wws._instances[wws.index]._addCommand = wws._instances[wws.index].addCommand;
  wws._instances[wws.index].addCommand = function(fnName, fn, forceOverwrite) {
    var result = wws._instances[this.index]._addCommand.call(
      wws._instances[wws.index],
      fnName,
      Promise.async(fn.bind(remoteWrapper), true),
      forceOverwrite
    );
    var commandWrapper = wrapAsyncObject(wws._instances[this.index], [fnName], {
      syncByDefault: syncByDefault,
      wrapAsync: wrapAsyncForWebdriver
    });
    // maybe this should use the remoteWrapper as well
    _.extend(wws._wrappers[this.index], _.omit(commandWrapper, '_original'));

    return result;
  };

  _.forEach([
    'addCommand',
    'transferPromiseness',
    'on', 'once', 'emit', 'removeListener', 'removeAllListeners', 'select'
  ], function(methodName) {
    if (wws._instances[wws.index][methodName]) {
      wws._wrappers[wws.index][methodName] =
          wws._instances[wws.index][methodName]
              .bind(wws._instances[wws.index]);
    }
  });
  wws.index++;
};


module.exports = webdriverioWithSync;
