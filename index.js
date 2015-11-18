// A wrapped webdriverio with synchronous API using fibers.

var webdriverio = require('webdriverio');
var _ = require('underscore');
var fs = require('fs');
var path = require('path');
var Fiber = require('fibers');
var Future = require('fibers/future');
var Promise = require('meteor-promise');
Promise.Fiber = Fiber;
var wrapAsync = require('xolvio-fiber-utils').wrapAsync;
var wrapAsyncObject = require('xolvio-fiber-utils').wrapAsyncObject;

var wrapAsyncForWebdriver = function (fn, context) {
  return wrapAsync(fn, context, {supportCallback: false});
};

var webdriverioWithSync = _.clone(webdriverio);

webdriverioWithSync.wrapAsync = wrapAsync;
webdriverioWithSync.wrapAsyncObject = wrapAsyncObject;

webdriverioWithSync.remote = function (options) {
  var syncByDefault = !(options && options.sync === false);
  var multiremote = options.browser0 ? true : false;
  var remote;

  if (multiremote) {
    remote = webdriverio.multiremote.apply(webdriverio, arguments);
  } else {
    remote = webdriverio.remote.apply(webdriverio, arguments);
  }

  // Run condition function in fiber
  var waitUntil = remote.waitUntil;
  remote.waitUntil = function (condition/*, arguments */) {
    arguments[0] = Promise.async(condition);

    return waitUntil.apply(remote, arguments);
  };

  // Wrap async all core commands
  var webdriverioPath = path.dirname(require.resolve('webdriverio'));
  var commandNames = _.chain(['protocol', 'commands'])
      .map(function(commandType) {
        var dir = path.resolve(webdriverioPath, path.join('lib', commandType));
        var files = fs.readdirSync(dir);
        return files.map(function(filename) {
          return filename.slice(0, -3);
        });
      })
      .flatten(true)
      .uniq()
      .value();

  var _browsers = [];
  var _wrappers = [];
  var index = 0;

  wrapAsyncBrowser(remote);
  var remoteWrapper = _wrappers[0];

  if (multiremote) {

    Object.keys(options).forEach(function(browserName) {
      var browser = remote.select(browserName);
      wrapAsyncBrowser(browser);
    });

    remoteWrapper.browsers = [];
    _wrappers.forEach(function(wrapper, index) {
      // if one of the multiremote browsers
      if (index > 0) {
        remoteWrapper.browsers.push(wrapper);
      }
    });
    remoteWrapper.init();
  }



  function wrapAsyncBrowser(browser) {
    console.log("_browsers.length", _browsers.length);
    _browsers.push(browser);
    _browsers[index].index = index;
    _wrappers.push(wrapAsyncObject(_browsers[index], commandNames, {
      syncByDefault: syncByDefault,
      wrapAsync: wrapAsyncForWebdriver
    }));
    console.log("_browsers index after", _browsers.length);

    var _addCommand = {};
    // Wrap async added commands
    _browsers[index]._addCommand = _browsers[index].addCommand;
    _browsers[index].addCommand = function(fnName, fn, forceOverwrite) {
      console.log("index in addCommand ", this.index);
      var result = _browsers[this.index]._addCommand.call(_browsers[index], fnName, Promise.async(fn), forceOverwrite);
      var commandWrapper = wrapAsyncObject(_browsers[this.index], [fnName], {
        syncByDefault: syncByDefault,
        wrapAsync: wrapAsyncForWebdriver
      });
      _.defaults(_wrappers[this.index], commandWrapper);
      return result;
    };

    _.forEach([
      'addCommand',
      'transferPromiseness',
      'on', 'once', 'emit', 'removeListener', 'removeAllListeners', 'select'
    ], function(methodName) {
      if (_browsers[index][methodName]) {
        _wrappers[index][methodName] =
            _browsers[index][methodName].bind(_browsers[index]);
      }
    });
    index++;
  }

  return remoteWrapper;
};

module.exports = webdriverioWithSync;
