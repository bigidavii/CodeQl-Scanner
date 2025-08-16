function isCompatible(ua) {
  return !!((function() {
    'use strict';
    return !this && Function.prototype.bind;
  }()) && 'querySelector' in document && 'localStorage' in window && !ua.match(/MSIE 10|NetFront|Opera Mini|S40OviBrowser|MeeGo|Android.+Glass|^Mozilla\/5\.0 .+ Gecko\/$|googleweblight|PLAYSTATION|PlayStation/));
}
if (!isCompatible(navigator.userAgent)) {
  document.documentElement.className = document.documentElement.className.replace(/(^|\s)client-js(\s|$)/, '$1client-nojs$2');
  while (window.NORLQ && NORLQ[0]) {
    NORLQ.shift()();
  }
  NORLQ = {
    push: function(fn) {
      fn();
    }
  };
  RLQ = {
    push: function() {}
  };
} else {
  if (window.performance && performance.mark) {
    performance.mark('mwStartup');
  }(function() {
    'use strict';
    var con = window.console;

    function logError(topic, data) {
      if (con.log) {
        var e = data.exception;
        var msg = (e ? 'Exception' : 'Error') + ' in ' + data.source + (data.module ? ' in module ' + data.module : '') + (e ? ':' : '.');
        con.log(msg);
        if (e && con.warn) {
          con.warn(e);
        }
      }
    }

    function Map() {
      this.values = Object.create(null);
    }
    Map.prototype = {
      constructor: Map,
      get: function(selection, fallback) {
        if (arguments.length < 2) {
          fallback = null;
        }
        if (typeof selection === 'string') {
          return selection in this.values ? this.values[selection] : fallback;
        }
        var results;
        if (Array.isArray(selection)) {
          results = {};
          for (var i = 0; i < selection.length; i++) {
            if (typeof selection[i] === 'string') {
              results[selection[i]] = selection[i] in this.values ? this.values[selection[i]] : fallback;
            }
          }
          return results;
        }
        if (selection === undefined) {
          results = {};
          for (var key in this.values) {
            results[key] = this.values[key];
          }
          return results;
        }
        return fallback;
      },
      set: function(selection, value) {
        if (arguments.length > 1) {
          if (typeof selection === 'string') {
            this.values[selection] = value;
            return true;
          }
        } else if (typeof selection === 'object') {
          for (var key in selection) {
            this.values[key] = selection[key];
          }
          return true;
        }
        return false;
      },
      exists: function(selection) {
        return typeof selection === 'string' && selection in this.values;
      }
    };
    var log = function() {};
    log.warn = con.warn ? Function.prototype.bind.call(con.warn, con) : function() {};
    var mw = {
      now: function() {
        var perf = window.performance;
        var navStart = perf && perf.timing && perf.timing.navigationStart;
        mw.now = navStart && perf.now ? function() {
          return navStart + perf.now();
        } : Date.now;
        return mw.now();
      },
      trackQueue: [],
      track: function(topic, data) {
        mw.trackQueue.push({
          topic: topic,
          data: data
        });
      },
      trackError: function(topic, data) {
        mw.track(topic, data);
        logError(topic, data);
      },
      Map: Map,
      config: new Map(),
      messages: new Map(),
      templates: new Map(),
      log: log
    };
    window.mw = window.mediaWiki = mw;
  }());
  (function() {
    'use strict';
    var StringSet, store, hasOwn = Object.hasOwnProperty;

    function defineFallbacks() {
      StringSet = window.Set || function() {
        var set = Object.create(null);
        return {
          add: function(value) {
            set[value] = true;
          },
          has: function(value) {
            return value in set;
          }
        };
      };
    }
    defineFallbacks();

    function fnv132(str) {
      var hash = 0x811C9DC5;
      for (var i = 0; i < str.length; i++) {
        hash += (hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24);
        hash ^= str.charCodeAt(i);
      }
      hash = (hash >>> 0).toString(36).slice(0, 5);
      while (hash.length < 5) {
        hash = '0' + hash;
      }
      return hash;
    }
    var isES6Supported = typeof Promise === 'function' && Promise.prototype.finally && /./g.flags === 'g' && (function() {
      try {
        new Function('(a = 0) => a');
        return true;
      } catch (e) {
        return false;
      }
    }());
    var registry = Object.create(null),
      sources = Object.create(null),
      handlingPendingRequests = false,
      pendingRequests = [],
      queue = [],
      jobs = [],
      willPropagate = false,
      errorModules = [],
      baseModules = ["jquery", "mediawiki.base"],
      marker = document.querySelector('meta[name="ResourceLoaderDynamicStyles"]'),
      lastCssBuffer, rAF = window.requestAnimationFrame || setTimeout;

    function addToHead(el, nextNode) {
      if (nextNode && nextNode.parentNode) {
        nextNode.parentNode.insertBefore(el, nextNode);
      } else {
        document.head.appendChild(el);
      }
    }

    function newStyleTag(text, nextNode) {
      var el = document.createElement('style');
      el.appendChild(document.createTextNode(text));
      addToHead(el, nextNode);
      return el;
    }

    function flushCssBuffer(cssBuffer) {
      if (cssBuffer === lastCssBuffer) {
        lastCssBuffer = null;
      }
      newStyleTag(cssBuffer.cssText, marker);
      for (var i = 0; i < cssBuffer.callbacks.length; i++) {
        cssBuffer.callbacks[i]();
      }
    }

    function addEmbeddedCSS(cssText, callback) {
      if (!lastCssBuffer || cssText.slice(0, 7) === '@import') {
        lastCssBuffer = {
          cssText: '',
          callbacks: []
        };
        rAF(flushCssBuffer.bind(null, lastCssBuffer));
      }
      lastCssBuffer.cssText += '\n' + cssText;
      lastCssBuffer.callbacks.push(callback);
    }

    function getCombinedVersion(modules) {
      var hashes = modules.reduce(function(result, module) {
        return result + registry[module].version;
      }, '');
      return fnv132(hashes);
    }

    function allReady(modules) {
      for (var i = 0; i < modules.length; i++) {
        if (mw.loader.getState(modules[i]) !== 'ready') {
          return false;
        }
      }
      return true;
    }

    function allWithImplicitReady(module) {
      return allReady(registry[module].dependencies) && (baseModules.indexOf(module) !== -1 || allReady(baseModules));
    }

    function anyFailed(modules) {
      for (var i = 0; i < modules.length; i++) {
        var state = mw.loader.getState(modules[i]);
        if (state === 'error' || state === 'missing') {
          return modules[i];
        }
      }
      return false;
    }

    function doPropagation() {
      var didPropagate = true;
      var module;
      while (didPropagate) {
        didPropagate = false;
        while (errorModules.length) {
          var errorModule = errorModules.shift(),
            baseModuleError = baseModules.indexOf(errorModule) !== -1;
          for (module in registry) {
            if (registry[module].state !== 'error' && registry[module].state !== 'missing') {
              if (baseModuleError && baseModules.indexOf(module) === -1) {
                registry[module].state = 'error';
                didPropagate = true;
              } else if (registry[module].dependencies.indexOf(errorModule) !== -1) {
                registry[module].state = 'error';
                errorModules.push(module);
                didPropagate = true;
              }
            }
          }
        }
        for (module in registry) {
          if (registry[module].state === 'loaded' && allWithImplicitReady(module)) {
            execute(module);
            didPropagate = true;
          }
        }
        for (var i = 0; i < jobs.length; i++) {
          var job = jobs[i];
          var failed = anyFailed(job.dependencies);
          if (failed !== false || allReady(job.dependencies)) {
            jobs.splice(i, 1);
            i -= 1;
            try {
              if (failed !== false && job.error) {
                job.error(new Error('Failed dependency: ' + failed), job.dependencies);
              } else if (failed === false && job.ready) {
                job.ready();
              }
            } catch (e) {
              mw.trackError('resourceloader.exception', {
                exception: e,
                source: 'load-callback'
              });
            }
            didPropagate = true;
          }
        }
      }
      willPropagate = false;
    }

    function setAndPropagate(module, state) {
      registry[module].state = state;
      if (state === 'ready') {
        store.add(module);
      } else if (state === 'error' || state === 'missing') {
        errorModules.push(module);
      } else if (state !== 'loaded') {
        return;
      }
      if (willPropagate) {
        return;
      }
      willPropagate = true;
      mw.requestIdleCallback(doPropagation, {
        timeout: 1
      });
    }

    function sortDependencies(module, resolved, unresolved) {
      if (!(module in registry)) {
        throw new Error('Unknown module: ' + module);
      }
      if (typeof registry[module].skip === 'string') {
        var skip = (new Function(registry[module].skip)());
        registry[module].skip = !!skip;
        if (skip) {
          registry[module].dependencies = [];
          setAndPropagate(module, 'ready');
          return;
        }
      }
      if (!unresolved) {
        unresolved = new StringSet();
      }
      var deps = registry[module].dependencies;
      unresolved.add(module);
      for (var i = 0; i < deps.length; i++) {
        if (resolved.indexOf(deps[i]) === -1) {
          if (unresolved.has(deps[i])) {
            throw new Error('Circular reference detected: ' + module + ' -> ' + deps[i]);
          }
          sortDependencies(deps[i], resolved, unresolved);
        }
      }
      resolved.push(module);
    }

    function resolve(modules) {
      var resolved = baseModules.slice();
      for (var i = 0; i < modules.length; i++) {
        sortDependencies(modules[i], resolved);
      }
      return resolved;
    }

    function resolveStubbornly(modules) {
      var resolved = baseModules.slice();
      for (var i = 0; i < modules.length; i++) {
        var saved = resolved.slice();
        try {
          sortDependencies(modules[i], resolved);
        } catch (err) {
          resolved = saved;
          mw.log.warn('Skipped unavailable module ' + modules[i]);
          if (modules[i] in registry) {
            mw.trackError('resourceloader.exception', {
              exception: err,
              source: 'resolve'
            });
          }
        }
      }
      return resolved;
    }

    function resolveRelativePath(relativePath, basePath) {
      var relParts = relativePath.match(/^((?:\.\.?\/)+)(.*)$/);
      if (!relParts) {
        return null;
      }
      var baseDirParts = basePath.split('/');
      baseDirParts.pop();
      var prefixes = relParts[1].split('/');
      prefixes.pop();
      var prefix;
      while ((prefix = prefixes.pop()) !== undefined) {
        if (prefix === '..') {
          baseDirParts.pop();
        }
      }
      return (baseDirParts.length ? baseDirParts.join('/') + '/' : '') + relParts[2];
    }

    function makeRequireFunction(moduleObj, basePath) {
      return function require(moduleName) {
        var fileName = resolveRelativePath(moduleName, basePath);
        if (fileName === null) {
          return mw.loader.require(moduleName);
        }
        if (hasOwn.call(moduleObj.packageExports, fileName)) {
          return moduleObj.packageExports[fileName];
        }
        var scriptFiles = moduleObj.script.files;
        if (!hasOwn.call(scriptFiles, fileName)) {
          throw new Error('Cannot require undefined file ' + fileName);
        }
        var result, fileContent = scriptFiles[fileName];
        if (typeof fileContent === 'function') {
          var moduleParam = {
            exports: {}
          };
          fileContent(makeRequireFunction(moduleObj, fileName), moduleParam, moduleParam.exports);
          result = moduleParam.exports;
        } else {
          result = fileContent;
        }
        moduleObj.packageExports[fileName] = result;
        return result;
      };
    }

    function addScript(src, callback) {
      var script = document.createElement('script');
      script.src = src;
      script.onload = script.onerror = function() {
        if (script.parentNode) {
          script.parentNode.removeChild(script);
        }
        if (callback) {
          callback();
          callback = null;
        }
      };
      document.head.appendChild(script);
      return script;
    }

    function queueModuleScript(src, moduleName, callback) {
      pendingRequests.push(function() {
        if (moduleName !== 'jquery') {
          window.require = mw.loader.require;
          window.module = registry[moduleName].module;
        }
        addScript(src, function() {
          delete window.module;
          callback();
          if (pendingRequests[0]) {
            pendingRequests.shift()();
          } else {
            handlingPendingRequests = false;
          }
        });
      });
      if (!handlingPendingRequests && pendingRequests[0]) {
        handlingPendingRequests = true;
        pendingRequests.shift()();
      }
    }

    function addLink(url, media, nextNode) {
      var el = document.createElement('link');
      el.rel = 'stylesheet';
      if (media) {
        el.media = media;
      }
      el.href = url;
      addToHead(el, nextNode);
      return el;
    }

    function domEval(code) {
      var script = document.createElement('script');
      if (mw.config.get('wgCSPNonce') !== false) {
        script.nonce = mw.config.get('wgCSPNonce');
      }
      script.text = code;
      document.head.appendChild(script);
      script.parentNode.removeChild(script);
    }

    function enqueue(dependencies, ready, error) {
      if (allReady(dependencies)) {
        if (ready) {
          ready();
        }
        return;
      }
      var failed = anyFailed(dependencies);
      if (failed !== false) {
        if (error) {
          error(new Error('Dependency ' + failed + ' failed to load'), dependencies);
        }
        return;
      }
      if (ready || error) {
        jobs.push({
          dependencies: dependencies.filter(function(module) {
            var state = registry[module].state;
            return state === 'registered' || state === 'loaded' || state === 'loading' || state === 'executing';
          }),
          ready: ready,
          error: error
        });
      }
      dependencies.forEach(function(module) {
        if (registry[module].state === 'registered' && queue.indexOf(module) === -1) {
          queue.push(module);
        }
      });
      mw.loader.work();
    }

    function execute(module) {
      if (registry[module].state !== 'loaded') {
        throw new Error('Module in state "' + registry[module].state + '" may not execute: ' + module);
      }
      registry[module].state = 'executing';
      var runScript = function() {
        var script = registry[module].script;
        var markModuleReady = function() {
          setAndPropagate(module, 'ready');
        };
        var nestedAddScript = function(arr, offset) {
          if (offset >= arr.length) {
            markModuleReady();
            return;
          }
          queueModuleScript(arr[offset], module, function() {
            nestedAddScript(arr, offset + 1);
          });
        };
        try {
          if (Array.isArray(script)) {
            nestedAddScript(script, 0);
          } else if (typeof script === 'function') {
            if (module === 'jquery') {
              script();
            } else {
              script(window.$, window.$, mw.loader.require, registry[module].module);
            }
            markModuleReady();
          } else if (typeof script === 'object' && script !== null) {
            var mainScript = script.files[script.main];
            if (typeof mainScript !== 'function') {
              throw new Error('Main file in module ' + module + ' must be a function');
            }
            mainScript(makeRequireFunction(registry[module], script.main), registry[module].module, registry[module].module.exports);
            markModuleReady();
          } else if (typeof script === 'string') {
            domEval(script);
            markModuleReady();
          } else {
            markModuleReady();
          }
        } catch (e) {
          setAndPropagate(module, 'error');
          mw.trackError('resourceloader.exception', {
            exception: e,
            module: module,
            source: 'module-execute'
          });
        }
      };
      if (registry[module].messages) {
        mw.messages.set(registry[module].messages);
      }
      if (registry[module].templates) {
        mw.templates.set(module, registry[module].templates);
      }
      var cssPending = 0;
      var cssHandle = function() {
        cssPending++;
        return function() {
          cssPending--;
          if (cssPending === 0) {
            var runScriptCopy = runScript;
            runScript = undefined;
            runScriptCopy();
          }
        };
      };
      if (registry[module].style) {
        for (var key in registry[module].style) {
          var value = registry[module].style[key];
          if (key === 'css') {
            for (var i = 0; i < value.length; i++) {
              addEmbeddedCSS(value[i], cssHandle());
            }
          } else if (key === 'url') {
            for (var media in value) {
              var urls = value[media];
              for (var j = 0; j < urls.length; j++) {
                addLink(urls[j], media, marker);
              }
            }
          }
        }
      }
      if (module === 'user') {
        var siteDeps;
        var siteDepErr;
        try {
          siteDeps = resolve(['site']);
        } catch (e) {
          siteDepErr = e;
          runScript();
        }
        if (!siteDepErr) {
          enqueue(siteDeps, runScript, runScript);
        }
      } else if (cssPending === 0) {
        runScript();
      }
    }

    function sortQuery(o) {
      var sorted = {};
      var list = [];
      for (var key in o) {
        list.push(key);
      }
      list.sort();
      for (var i = 0; i < list.length; i++) {
        sorted[list[i]] = o[list[i]];
      }
      return sorted;
    }

    function buildModulesString(moduleMap) {
      var str = [];
      var list = [];
      var p;

      function restore(suffix) {
        return p + suffix;
      }
      for (var prefix in moduleMap) {
        p = prefix === '' ? '' : prefix + '.';
        str.push(p + moduleMap[prefix].join(','));
        list.push.apply(list, moduleMap[prefix].map(restore));
      }
      return {
        str: str.join('|'),
        list: list
      };
    }

    function makeQueryString(params) {
      var str = '';
      for (var key in params) {
        str += (str ? '&' : '') + encodeURIComponent(key) + '=' + encodeURIComponent(params[key]);
      }
      return str;
    }

    function batchRequest(batch) {
      if (!batch.length) {
        return;
      }
      var sourceLoadScript, currReqBase, moduleMap;

      function doRequest() {
        var query = Object.create(currReqBase),
          packed = buildModulesString(moduleMap);
        query.modules = packed.str;
        query.version = getCombinedVersion(packed.list);
        query = sortQuery(query);
        addScript(sourceLoadScript + '?' + makeQueryString(query));
      }
      batch.sort();
      var reqBase = {
        "lang": "en"
      };
      var splits = Object.create(null);
      for (var b = 0; b < batch.length; b++) {
        var bSource = registry[batch[b]].source;
        var bGroup = registry[batch[b]].group;
        if (!splits[bSource]) {
          splits[bSource] = Object.create(null);
        }
        if (!splits[bSource][bGroup]) {
          splits[bSource][bGroup] = [];
        }
        splits[bSource][bGroup].push(batch[b]);
      }
      for (var source in splits) {
        sourceLoadScript = sources[source];
        for (var group in splits[source]) {
          var modules = splits[source][group];
          currReqBase = Object.create(reqBase);
          if (group === 0 && mw.config.get('wgUserName') !== null) {
            currReqBase.user = mw.config.get('wgUserName');
          }
          var currReqBaseLength = makeQueryString(currReqBase).length + 23;
          var length = 0;
          moduleMap = Object.create(null);
          for (var i = 0; i < modules.length; i++) {
            var lastDotIndex = modules[i].lastIndexOf('.'),
              prefix = modules[i].slice(0, Math.max(0, lastDotIndex)),
              suffix = modules[i].slice(lastDotIndex + 1),
              bytesAdded = moduleMap[prefix] ? suffix.length + 3 : modules[i].length + 3;
            if (length && length + currReqBaseLength + bytesAdded > mw.loader.maxQueryLength) {
              doRequest();
              length = 0;
              moduleMap = Object.create(null);
            }
            if (!moduleMap[prefix]) {
              moduleMap[prefix] = [];
            }
            length += bytesAdded;
            moduleMap[prefix].push(suffix);
          }
          doRequest();
        }
      }
    }

    function asyncEval(implementations, cb) {
      if (!implementations.length) {
        return;
      }
      mw.requestIdleCallback(function() {
        try {
          domEval(implementations.join(';'));
        } catch (err) {
          cb(err);
        }
      });
    }

    function getModuleKey(module) {
      return module in registry ? (module + '@' + registry[module].version) : null;
    }

    function splitModuleKey(key) {
      var index = key.lastIndexOf('@');
      if (index === -1 || index === 0) {
        return {
          name: key,
          version: ''
        };
      }
      return {
        name: key.slice(0, index),
        version: key.slice(index + 1)
      };
    }

    function registerOne(module, version, dependencies, group, source, skip) {
      if (module in registry) {
        throw new Error('module already registered: ' + module);
      }
      version = String(version || '');
      if (version.slice(-1) === '!') {
        if (!isES6Supported) {
          return;
        }
        version = version.slice(0, -1);
      }
      registry[module] = {
        module: {
          exports: {}
        },
        packageExports: {},
        version: version,
        dependencies: dependencies || [],
        group: typeof group === 'undefined' ? null : group,
        source: typeof source === 'string' ? source : 'local',
        state: 'registered',
        skip: typeof skip === 'string' ? skip : null
      };
    }
    mw.loader = {
      moduleRegistry: registry,
      maxQueryLength: 2000,
      addStyleTag: newStyleTag,
      addScriptTag: addScript,
      addLinkTag: addLink,
      enqueue: enqueue,
      resolve: resolve,
      work: function() {
        store.init();
        var q = queue.length,
          storedImplementations = [],
          storedNames = [],
          requestNames = [],
          batch = new StringSet();
        while (q--) {
          var module = queue[q];
          if (mw.loader.getState(module) === 'registered' && !batch.has(module)) {
            registry[module].state = 'loading';
            batch.add(module);
            var implementation = store.get(module);
            if (implementation) {
              storedImplementations.push(implementation);
              storedNames.push(module);
            } else {
              requestNames.push(module);
            }
          }
        }
        queue = [];
        asyncEval(storedImplementations, function(err) {
          store.stats.failed++;
          store.clear();
          mw.trackError('resourceloader.exception', {
            exception: err,
            source: 'store-eval'
          });
          var failed = storedNames.filter(function(name) {
            return registry[name].state === 'loading';
          });
          batchRequest(failed);
        });
        batchRequest(requestNames);
      },
      addSource: function(ids) {
        for (var id in ids) {
          if (id in sources) {
            throw new Error('source already registered: ' + id);
          }
          sources[id] = ids[id];
        }
      },
      register: function(modules) {
        if (typeof modules !== 'object') {
          registerOne.apply(null, arguments);
          return;
        }

        function resolveIndex(dep) {
          return typeof dep === 'number' ? modules[dep][0] : dep;
        }
        for (var i = 0; i < modules.length; i++) {
          var deps = modules[i][2];
          if (deps) {
            for (var j = 0; j < deps.length; j++) {
              deps[j] = resolveIndex(deps[j]);
            }
          }
          registerOne.apply(null, modules[i]);
        }
      },
      implement: function(module, script, style, messages, templates) {
        var split = splitModuleKey(module),
          name = split.name,
          version = split.version;
        if (!(name in registry)) {
          mw.loader.register(name);
        }
        if (registry[name].script !== undefined) {
          throw new Error('module already implemented: ' + name);
        }
        if (version) {
          registry[name].version = version;
        }
        registry[name].script = script || null;
        registry[name].style = style || null;
        registry[name].messages = messages || null;
        registry[name].templates = templates || null;
        if (registry[name].state !== 'error' && registry[name].state !== 'missing') {
          setAndPropagate(name, 'loaded');
        }
      },
      load: function(modules, type) {
        if (typeof modules === 'string' && /^(https?:)?\/?\//.test(modules)) {
          if (type === 'text/css') {
            addLink(modules);
          } else if (type === 'text/javascript' || type === undefined) {
            addScript(modules);
          } else {
            throw new Error('Invalid type ' + type);
          }
        } else {
          modules = typeof modules === 'string' ? [modules] : modules;
          enqueue(resolveStubbornly(modules));
        }
      },
      state: function(states) {
        for (var module in states) {
          if (!(module in registry)) {
            mw.loader.register(module);
          }
          setAndPropagate(module, states[module]);
        }
      },
      getState: function(module) {
        return module in registry ? registry[module].state : null;
      },
      require: function(moduleName) {
        if (mw.loader.getState(moduleName) !== 'ready') {
          throw new Error('Module "' + moduleName + '" is not loaded');
        }
        return registry[moduleName].module.exports;
      }
    };
    var hasPendingWrites = false;

    function flushWrites() {
      store.prune();
      while (store.queue.length) {
        store.set(store.queue.shift());
      }
      try {
        localStorage.removeItem(store.key);
        var data = JSON.stringify(store);
        localStorage.setItem(store.key, data);
      } catch (e) {
        mw.trackError('resourceloader.exception', {
          exception: e,
          source: 'store-localstorage-update'
        });
      }
      hasPendingWrites = false;
    }
    mw.loader.store = store = {
      enabled: null,
      items: {},
      queue: [],
      stats: {
        hits: 0,
        misses: 0,
        expired: 0,
        failed: 0
      },
      toJSON: function() {
        return {
          items: store.items,
          vary: store.vary,
          asOf: Math.ceil(Date.now() / 1e7)
        };
      },
      key: "MediaWikiModuleStore:en_wikidb_gw2",
      vary: "fallback:1:en",
      init: function() {
        if (this.enabled === null) {
          this.enabled = false;
          if (false) {
            this.load();
          } else {
            this.clear();
          }
        }
      },
      load: function() {
        try {
          var raw = localStorage.getItem(this.key);
          this.enabled = true;
          var data = JSON.parse(raw);
          if (data && data.vary === this.vary && data.items && Date.now() < (data.asOf * 1e7) + 259e7) {
            this.items = data.items;
          }
        } catch (e) {}
      },
      get: function(module) {
        if (this.enabled) {
          var key = getModuleKey(module);
          if (key in this.items) {
            this.stats.hits++;
            return this.items[key];
          }
          this.stats.misses++;
        }
        return false;
      },
      add: function(module) {
        if (this.enabled) {
          this.queue.push(module);
          this.requestUpdate();
        }
      },
      set: function(module) {
        var args, encodedScript, descriptor = registry[module],
          key = getModuleKey(module);
        if (key in this.items || !descriptor || descriptor.state !== 'ready' || !descriptor.version || descriptor.group === 1 || descriptor.group === 0 || [descriptor.script, descriptor.style, descriptor.messages, descriptor.templates].indexOf(undefined) !== -1) {
          return;
        }
        try {
          if (typeof descriptor.script === 'function') {
            encodedScript = String(descriptor.script);
          } else if (typeof descriptor.script === 'object' && descriptor.script && !Array.isArray(descriptor.script)) {
            encodedScript = '{' + 'main:' + JSON.stringify(descriptor.script.main) + ',' + 'files:{' + Object.keys(descriptor.script.files).map(function(file) {
              var value = descriptor.script.files[file];
              return JSON.stringify(file) + ':' + (typeof value === 'function' ? value : JSON.stringify(value));
            }).join(',') + '}}';
          } else {
            encodedScript = JSON.stringify(descriptor.script);
          }
          args = [JSON.stringify(key), encodedScript,
            JSON.stringify(descriptor.style), JSON.stringify(descriptor.messages), JSON.stringify(descriptor.templates)
          ];
        } catch (e) {
          mw.trackError('resourceloader.exception', {
            exception: e,
            source: 'store-localstorage-json'
          });
          return;
        }
        var src = 'mw.loader.implement(' + args.join(',') + ');';
        if (src.length > 1e5) {
          return;
        }
        this.items[key] = src;
      },
      prune: function() {
        for (var key in this.items) {
          if (getModuleKey(splitModuleKey(key).name) !== key) {
            this.stats.expired++;
            delete this.items[key];
          }
        }
      },
      clear: function() {
        this.items = {};
        try {
          localStorage.removeItem(this.key);
        } catch (e) {}
      },
      requestUpdate: function() {
        if (!hasPendingWrites) {
          hasPendingWrites = true;
          setTimeout(function() {
            mw.requestIdleCallback(flushWrites);
          }, 2000);
        }
      }
    };
  }());
  mw.requestIdleCallbackInternal = function(callback) {
    setTimeout(function() {
      var start = mw.now();
      callback({
        didTimeout: false,
        timeRemaining: function() {
          return Math.max(0, 50 - (mw.now() - start));
        }
      });
    }, 1);
  };
  mw.requestIdleCallback = window.requestIdleCallback ? window.requestIdleCallback.bind(window) : mw.requestIdleCallbackInternal;
  (function() {
    var queue;
    mw.loader.addSource({
      "local": "/load.php"
    });
    mw.loader.register([
      ["user.options", "12s5i", [], 1],
      ["mediawiki.skinning.interface", "r7qld"],
      ["jquery.makeCollapsible.styles", "1qbvc"],
      ["mediawiki.skinning.content.parsoid", "pvg6m"],
      ["jquery", "p9z7x"],
      ["es6-polyfills", "1xwex", [], null, null, "return Array.prototype.find\u0026\u0026Array.prototype.findIndex\u0026\u0026Array.prototype.includes\u0026\u0026typeof Promise==='function'\u0026\u0026Promise.prototype.finally;"],
      ["web2017-polyfills", "5cxhc", [5], null, null, "return'IntersectionObserver'in window\u0026\u0026typeof fetch==='function'\u0026\u0026typeof URL==='function'\u0026\u0026'toJSON'in URL.prototype;"],
      ["mediawiki.base", "16qbv", [4]],
      ["jquery.chosen", "fjvzv"],
      ["jquery.client", "1jnox"],
      ["jquery.color", "1y5ur"],
      ["jquery.confirmable", "1qc1o", [104]],
      ["jquery.cookie", "emj1l"],
      ["jquery.form", "1djyv"],
      ["jquery.fullscreen", "1lanf"],
      ["jquery.highlightText", "a2wnf", [78]],
      ["jquery.hoverIntent", "1cahm"],
      ["jquery.i18n", "1pu0k", [103]],
      ["jquery.lengthLimit", "k5zgm", [62]],
      ["jquery.makeCollapsible", "1inna", [2, 78]],
      ["jquery.spinner", "1rx3f", [21]],
      ["jquery.spinner.styles", "153wt"],
      ["jquery.suggestions", "1g6wh", [15]],
      ["jquery.tablesorter", "owtca", [24, 105, 78]],
      ["jquery.tablesorter.styles", "rwcx6"],
      ["jquery.textSelection", "m1do8", [9]],
      ["jquery.throttle-debounce", "1p2bq"],
      ["jquery.tipsy", "1rhhm"],
      ["jquery.ui", "6vx3o"],
      ["moment", "x1k6h", [101, 78]],
      ["vue", "zfi8r!"],
      ["@vue/composition-api", "scw0q!", [30]],
      ["vuex", "1twvy!", [30]],
      ["wvui", "v4ef5!", [31]],
      ["wvui-search", "1nhzn!", [30]],
      ["@wikimedia/codex", "r6zyv!", [30]],
      ["@wikimedia/codex-search", "1p7vn!", [30]],
      ["mediawiki.template", "bca94"],
      ["mediawiki.template.mustache", "199kg", [37]],
      ["mediawiki.apipretty", "185i4"],
      ["mediawiki.api", "4z1te", [68, 104]],
      ["mediawiki.content.json", "h3m91"],
      ["mediawiki.confirmCloseWindow", "1ewwa"],
      ["mediawiki.debug", "d8is9", [188]],
      ["mediawiki.diff", "paqy5"],
      ["mediawiki.diff.styles", "na4y2"],
      ["mediawiki.feedback", "dk4zz", [557, 196]],
      ["mediawiki.feedlink", "1yq8n"],
      ["mediawiki.filewarning", "1brek", [188, 200]],
      ["mediawiki.ForeignApi", "6vgsr", [50]],
      ["mediawiki.ForeignApi.core", "llzm2", [75, 40, 184]],
      ["mediawiki.helplink", "wjdrt"],
      ["mediawiki.hlist", "1eh1m"],
      ["mediawiki.htmlform", "1icg3", [18, 78]],
      ["mediawiki.htmlform.ooui", "1m5pb", [188]],
      ["mediawiki.htmlform.styles", "1mdmd"],
      ["mediawiki.htmlform.ooui.styles", "t3imb"],
      ["mediawiki.icon", "17xpk"],
      ["mediawiki.inspect", "88qa7", [62, 78]],
      ["mediawiki.notification", "1vc6u", [78, 84]],
      ["mediawiki.notification.convertmessagebox", "1kd6x", [59]],
      ["mediawiki.notification.convertmessagebox.styles", "19vc0"],
      ["mediawiki.String", "1vc9s"],
      ["mediawiki.pager.styles", "eo2ge"],
      ["mediawiki.pager.tablePager", "1tupc"],
      ["mediawiki.pulsatingdot", "1i1zo"],
      ["mediawiki.searchSuggest", "q7byr", [22, 40]],
      ["mediawiki.storage", "2gicm", [78]],
      ["mediawiki.Title", "1345o", [62, 78]],
      ["mediawiki.Upload", "ooev2", [40]],
      ["mediawiki.ForeignUpload", "2bu58", [49, 69]],
      ["mediawiki.Upload.Dialog", "198dv", [72]],
      ["mediawiki.Upload.BookletLayout", "178we", [69, 76, 29, 191, 196, 201, 202]],
      ["mediawiki.ForeignStructuredUpload.BookletLayout", "3n0xt", [70, 72, 108, 167, 161]],
      ["mediawiki.toc", "1jhap", [81]],
      ["mediawiki.Uri", "5izs0", [78]],
      ["mediawiki.user", "1fogn", [40, 81]],
      ["mediawiki.userSuggest", "1hhzv", [22, 40]],
      ["mediawiki.util", "17o8f", [9, 6]],
      ["mediawiki.checkboxtoggle", "159pl"],
      ["mediawiki.checkboxtoggle.styles", "1b0zv"],
      ["mediawiki.cookie", "u71jo", [12]],
      ["mediawiki.experiments", "dhcyy"],
      ["mediawiki.editfont.styles", "12q5o"],
      ["mediawiki.visibleTimeout", "xcitq"],
      ["mediawiki.action.delete", "1ssul", [18, 188]],
      ["mediawiki.action.edit", "mstk4", [25, 87, 40, 83, 163]],
      ["mediawiki.action.edit.styles", "1o953"],
      ["mediawiki.action.edit.collapsibleFooter", "za3yf", [19, 57, 67]],
      ["mediawiki.action.edit.preview", "1xom3", [20, 114, 76]],
      ["mediawiki.action.history", "cpbx3", [19]],
      ["mediawiki.action.history.styles", "g8wz5"],
      ["mediawiki.action.protect", "1dt0w", [18, 188]],
      ["mediawiki.action.view.metadata", "13p0w", [99]],
      ["mediawiki.action.view.categoryPage.styles", "z9xgj"],
      ["mediawiki.action.view.postEdit", "13vzn", [104, 59, 188, 207]],
      ["mediawiki.action.view.redirect", "iqcjx"],
      ["mediawiki.action.view.redirectPage", "rqi3f"],
      ["mediawiki.action.edit.editWarning", "ihdqq", [25, 42, 104]],
      ["mediawiki.action.view.filepage", "mbna9"],
      ["mediawiki.action.styles", "g8x3w"],
      ["mediawiki.language", "1ysaw", [102]],
      ["mediawiki.cldr", "w8zqb", [103]],
      ["mediawiki.libs.pluralruleparser", "1kwne"],
      ["mediawiki.jqueryMsg", "wrkoy", [62, 101, 78, 0]],
      ["mediawiki.language.months", "1iag2", [101]],
      ["mediawiki.language.names", "159lr", [101]],
      ["mediawiki.language.specialCharacters", "f8zox", [101]],
      ["mediawiki.libs.jpegmeta", "1h4oh"],
      ["mediawiki.page.gallery", "19ugl", [110, 78]],
      ["mediawiki.page.gallery.styles", "16scj"],
      ["mediawiki.page.gallery.slideshow", "1f4yv", [40, 191, 210, 212]],
      ["mediawiki.page.ready", "1toj5", [40]],
      ["mediawiki.page.watch.ajax", "qcw9w", [40]],
      ["mediawiki.page.preview", "8a65o", [19, 25, 40, 44, 45, 188]],
      ["mediawiki.page.image.pagination", "kn7b4", [20, 78]],
      ["mediawiki.rcfilters.filters.base.styles", "k81tw"],
      ["mediawiki.rcfilters.highlightCircles.seenunseen.styles", "ce9wh"],
      ["mediawiki.rcfilters.filters.ui", "1rqfv", [19, 75, 76, 158, 197, 204, 206, 207, 208, 210, 211]],
      ["mediawiki.interface.helpers.styles", "wdfed"],
      ["mediawiki.special", "33qsi"],
      ["mediawiki.special.apisandbox", "y3edx", [19, 75, 178, 164, 187]],
      ["mediawiki.special.block", "1n3h1", [53, 161, 177, 168, 178, 175, 204]],
      ["mediawiki.misc-authed-ooui", "1iw6h", [54, 158, 163]],
      ["mediawiki.misc-authed-pref", "16eja", [0]],
      ["mediawiki.misc-authed-curate", "1vp4k", [11, 20, 40]],
      ["mediawiki.special.changeslist", "19kr3"],
      ["mediawiki.special.changeslist.watchlistexpiry", "1tnj7", [120, 207]],
      ["mediawiki.special.changeslist.enhanced", "1kflq"],
      ["mediawiki.special.changeslist.legend", "1b53v"],
      ["mediawiki.special.changeslist.legend.js", "qa88i", [19, 81]],
      ["mediawiki.special.contributions", "1luqq", [19, 104, 161, 187]],
      ["mediawiki.special.edittags", "79img", [8, 18]],
      ["mediawiki.special.import.styles.ooui", "1hzv9"],
      ["mediawiki.special.changecredentials", "f9fqt"],
      ["mediawiki.special.changeemail", "10bxu"],
      ["mediawiki.special.preferences.ooui", "17q0e", [42, 83, 60, 67, 168, 163]],
      ["mediawiki.special.preferences.styles.ooui", "wdoru"],
      ["mediawiki.special.revisionDelete", "13kw3", [18]],
      ["mediawiki.special.search", "11pp3", [180]],
      ["mediawiki.special.search.commonsInterwikiWidget", "e3z5z", [75, 40]],
      ["mediawiki.special.search.interwikiwidget.styles", "cxv8q"],
      ["mediawiki.special.search.styles", "1murh"],
      ["mediawiki.special.unwatchedPages", "mk9s7", [40]],
      ["mediawiki.special.upload", "1kaju", [20, 40, 42, 108, 120, 37]],
      ["mediawiki.special.userlogin.common.styles", "1q3ah"],
      ["mediawiki.special.userlogin.login.styles", "1w9oo"],
      ["mediawiki.special.createaccount", "h4vea", [40]],
      ["mediawiki.special.userlogin.signup.styles", "10luo"],
      ["mediawiki.special.userrights", "4k0n6", [18, 60]],
      ["mediawiki.special.watchlist", "lr1n3", [40, 188, 207]],
      ["mediawiki.ui", "1qw5m"],
      ["mediawiki.ui.checkbox", "3rebp"],
      ["mediawiki.ui.radio", "lhqjo"],
      ["mediawiki.ui.anchor", "1wj82"],
      ["mediawiki.ui.button", "19cke"],
      ["mediawiki.ui.input", "1lzvw"],
      ["mediawiki.ui.icon", "10ybi"],
      ["mediawiki.widgets", "1r1t4", [40, 159, 191, 201, 202]],
      ["mediawiki.widgets.styles", "1x5du"],
      ["mediawiki.widgets.AbandonEditDialog", "1tcrg", [196]],
      ["mediawiki.widgets.DateInputWidget", "1axcu", [162, 29, 191, 212]],
      ["mediawiki.widgets.DateInputWidget.styles", "15tly"],
      ["mediawiki.widgets.visibleLengthLimit", "m325n", [18, 188]],
      ["mediawiki.widgets.datetime", "1m5jf", [78, 188, 207, 211, 212]],
      ["mediawiki.widgets.expiry", "m5uji", [164, 29, 191]],
      ["mediawiki.widgets.CheckMatrixWidget", "k9si1", [188]],
      ["mediawiki.widgets.CategoryMultiselectWidget", "x4tey", [49, 191]],
      ["mediawiki.widgets.SelectWithInputWidget", "yzuek", [169, 191]],
      ["mediawiki.widgets.SelectWithInputWidget.styles", "vkr7h"],
      ["mediawiki.widgets.SizeFilterWidget", "1hmr4", [171, 191]],
      ["mediawiki.widgets.SizeFilterWidget.styles", "ceybj"],
      ["mediawiki.widgets.MediaSearch", "1y1s4", [49, 76, 191]],
      ["mediawiki.widgets.Table", "p2qhh", [191]],
      ["mediawiki.widgets.TagMultiselectWidget", "1erse", [191]],
      ["mediawiki.widgets.UserInputWidget", "jsk5k", [40, 191]],
      ["mediawiki.widgets.UsersMultiselectWidget", "1m6vb", [40, 191]],
      ["mediawiki.widgets.NamespacesMultiselectWidget", "pwj2l", [191]],
      ["mediawiki.widgets.TitlesMultiselectWidget", "gt95w", [158]],
      ["mediawiki.widgets.TagMultiselectWidget.styles", "1rjw4"],
      ["mediawiki.widgets.SearchInputWidget", "z70j2", [66, 158, 207]],
      ["mediawiki.widgets.SearchInputWidget.styles", "9327p"],
      ["mediawiki.watchstar.widgets", "1gkq3", [187]],
      ["mediawiki.deflate", "1ci7b"],
      ["oojs", "ewqeo"],
      ["mediawiki.router", "1ugrh", [186]],
      ["oojs-router", "m96yy", [184]],
      ["oojs-ui", "1jh3r", [194, 191, 196]],
      ["oojs-ui-core", "p1ebe", [101, 184, 190, 189, 198]],
      ["oojs-ui-core.styles", "6w3b4"],
      ["oojs-ui-core.icons", "wt078"],
      ["oojs-ui-widgets", "yjsdo", [188, 193]],
      ["oojs-ui-widgets.styles", "13ehs"],
      ["oojs-ui-widgets.icons", "17p5f"],
      ["oojs-ui-toolbars", "1ruxz", [188, 195]],
      ["oojs-ui-toolbars.icons", "6ddqd"],
      ["oojs-ui-windows", "8mo99", [188, 197]],
      ["oojs-ui-windows.icons", "cvlae"],
      ["oojs-ui.styles.indicators", "1w2sr"],
      ["oojs-ui.styles.icons-accessibility", "sp3ld"],
      ["oojs-ui.styles.icons-alerts", "1nffd"],
      ["oojs-ui.styles.icons-content", "jzl9z"],
      ["oojs-ui.styles.icons-editing-advanced", "1dcj9"],
      ["oojs-ui.styles.icons-editing-citation", "4jmj7"],
      ["oojs-ui.styles.icons-editing-core", "1y2n6"],
      ["oojs-ui.styles.icons-editing-list", "dijje"],
      ["oojs-ui.styles.icons-editing-styling", "1efz4"],
      ["oojs-ui.styles.icons-interactions", "1lhdt"],
      ["oojs-ui.styles.icons-layout", "1pe2h"],
      ["oojs-ui.styles.icons-location", "1bvq4"],
      ["oojs-ui.styles.icons-media", "17uel"],
      ["oojs-ui.styles.icons-moderation", "a97tk"],
      ["oojs-ui.styles.icons-movement", "1ng9a"],
      ["oojs-ui.styles.icons-user", "18t9o"],
      ["oojs-ui.styles.icons-wikimedia", "mso3u"],
      ["skins.minerva.base.styles", "1qf56"],
      ["skins.minerva.content.styles.images", "1r97a"],
      ["skins.minerva.icons.loggedin", "1rmwu"],
      ["skins.minerva.amc.styles", "1eeb3"],
      ["skins.minerva.overflow.icons", "os6bi"],
      ["skins.minerva.icons.wikimedia", "3wlv7"],
      ["skins.minerva.icons.images.scripts.misc", "18xp5"],
      ["skins.minerva.icons.page.issues.uncolored", "1lbnz"],
      ["skins.minerva.icons.page.issues.default.color", "u7812"],
      ["skins.minerva.icons.page.issues.medium.color", "bl0zq"],
      ["skins.minerva.mainPage.styles", "98ddm"],
      ["skins.minerva.userpage.styles", "1hlba"],
      ["skins.minerva.talk.styles", "l87ai"],
      ["skins.minerva.personalMenu.icons", "1vlvi"],
      ["skins.minerva.mainMenu.advanced.icons", "1xuc4"],
      ["skins.minerva.mainMenu.icons", "b5vv3"],
      ["skins.minerva.mainMenu.styles", "18eqb"],
      ["skins.minerva.loggedin.styles", "1bz3m"],
      ["skins.minerva.scripts", "1yw52", [75, 82, 154, 311, 221, 223, 224, 222, 230, 231, 234]],
      ["skins.minerva.messageBox.styles", "595m8"],
      ["skins.minerva.categories.styles", "1m0n6"],
      ["skins.monobook.styles", "lzhxd"],
      ["skins.monobook.scripts", "13atf", [76, 200]],
      ["skins.vector.search", "tkov3!", [36, 75]],
      ["skins.vector.styles.legacy", "1pjkd"],
      ["skins.vector.AB.styles", "96a9s"],
      ["skins.vector.styles", "z57pg"],
      ["skins.vector.icons.js", "12vx4"],
      ["skins.vector.icons", "siub1"],
      ["skins.vector.es6", "1xmtq!", [82, 112, 113, 76, 242]],
      ["skins.vector.js", "krfqj", [112, 242]],
      ["skins.vector.legacy.js", "omaiv", [112]],
      ["ext.categoryTree", "1j302", [40]],
      ["ext.categoryTree.styles", "1d80w"],
      ["ext.cite.styles", "1o8is"],
      ["ext.cite.style", "6t36z"],
      ["ext.cite.visualEditor.core", "4m7e0", ["ext.visualEditor.mwcore", "ext.visualEditor.mwtransclusion"]],
      ["ext.cite.visualEditor", "s3t01", [250, 249, 251, "ext.visualEditor.base", "ext.visualEditor.mediawiki", 200, 203, 207]],
      ["ext.cite.ux-enhancements", "14f0k"],
      ["ext.dismissableSiteNotice", "1aopq", [12, 78]],
      ["ext.dismissableSiteNotice.styles", "a7ku7"],
      ["ext.inputBox.styles", "1dv4m"],
      ["ext.nuke.confirm", "14ono", [104]],
      ["ext.spamBlacklist.visualEditor", "xlus7"],
      ["ext.wikiEditor", "1fena", [25, 28, 107, 76, 158, 203, 204, 205, 206, 210, 37], 2],
      ["ext.wikiEditor.styles", "rlj9c", [], 2],
      ["ext.wikiEditor.images", "13a92"],
      ["ext.wikiEditor.realtimepreview", "1w5xs", [259, 261, 114, 65, 67, 207]],
      ["ext.abuseFilter", "1y93l"],
      ["ext.abuseFilter.edit", "vtjdy", [20, 25, 40, 42, 191]],
      ["ext.abuseFilter.tools", "i65q3", [20, 40]],
      ["ext.abuseFilter.examine", "pzrfk", [20, 40]],
      ["ext.abuseFilter.ace", "1918f", ["ext.codeEditor.ace"]],
      ["ext.abuseFilter.visualEditor", "5wt0f"],
      ["ext.checkUser", "189k5", [23, 75, 63, 67, 158, 204, 207, 209, 211, 213]],
      ["ext.checkUser.styles", "14d8h"],
      ["ext.guidedTour.tour.checkuserinvestigateform", "1jrhm", ["ext.guidedTour"]],
      ["ext.guidedTour.tour.checkuserinvestigate", "16oj9", [269, "ext.guidedTour"]],
      ["ext.confirmEdit.editPreview.ipwhitelist.styles", "11y4q"],
      ["ext.confirmEdit.visualEditor", "rlq1b", [556]],
      ["ext.confirmEdit.simpleCaptcha", "14a9d"],
      ["ext.confirmEdit.hCaptcha.visualEditor", "xsoz4"],
      ["ext.echo.logger", "1eha4", [76, 184]],
      ["ext.echo.ui.desktop", "1uvhn", [284, 279]],
      ["ext.echo.ui", "1ebvu", [280, 277, 554, 191, 200, 201, 207, 211, 212, 213]],
      ["ext.echo.dm", "1n4ej", [283, 29]],
      ["ext.echo.api", "14pf5", [49]],
      ["ext.echo.mobile", "sxoyt", [279, 185, 38]],
      ["ext.echo.init", "1kmqf", [281]],
      ["ext.echo.styles.badge", "1ha8p"],
      ["ext.echo.styles.notifications", "7mhmt"],
      ["ext.echo.styles.alert", "7jmh0"],
      ["ext.echo.special", "eys4y", [288, 279]],
      ["ext.echo.styles.special", "nu0oq"],
      ["ext.interwiki.specialpage", "lsm82"],
      ["ext.thanks.images", "c7z9p"],
      ["ext.thanks", "26n5n", [40, 81]],
      ["ext.thanks.corethank", "74qwj", [291, 11, 196]],
      ["ext.thanks.mobilediff", "q2djv", [290, 311]],
      ["ext.thanks.flowthank", "5eig0", [291, 196]],
      ["ext.wikiLove.icon", "evna5"],
      ["ext.wikiLove.startup", "me8y6", [28, 40, 155]],
      ["ext.wikiLove.init", "150nu", [296]],
      ["ext.popups.icons", "gh6e7"],
      ["ext.popups.images", "1k6yd"],
      ["ext.popups", "1wum5"],
      ["ext.popups.main", "r9gak", [298, 299, 75, 82, 67, 155, 152, 157, 76]],
      ["mobile.pagelist.styles", "5csrr"],
      ["mobile.pagesummary.styles", "11wvt"],
      ["mobile.placeholder.images", "a9ctz"],
      ["mobile.userpage.styles", "1uooy"],
      ["mobile.startup.images", "h8jla"],
      ["mobile.init.styles", "y6oqe"],
      ["mobile.init", "1qeh2", [75, 311]],
      ["mobile.ooui.icons", "1why2"],
      ["mobile.user.icons", "4zsm3"],
      ["mobile.startup", "1hwh7", [113, 185, 67, 38, 155, 157, 76, 309, 302, 303, 304, 306]],
      ["mobile.editor.overlay", "rcef9", [42, 83, 59, 156, 160, 313, 311, 310, 187, 204]],
      ["mobile.editor.images", "1w42k"],
      ["mobile.talk.overlays", "15bky", [154, 312]],
      ["mobile.mediaViewer", "106sl", [311]],
      ["mobile.languages.structured", "8wrj9", [311]],
      ["mobile.special.mobileoptions.styles", "14zz3"],
      ["mobile.special.mobileoptions.scripts", "1ic8c", [311]],
      ["mobile.special.nearby.styles", "1xr51"],
      ["mobile.special.userlogin.scripts", "14dsq"],
      ["mobile.special.nearby.scripts", "1cuz7", [75, 319, 311]],
      ["mobile.special.mobilediff.images", "25wm9"],
      ["ext.cirrus.serp", "jrrue", [75, 185]],
      ["ext.cirrus.explore-similar", "q3ido", [40, 38]],
      ["ext.advancedSearch.initialstyles", "1rvso"],
      ["ext.advancedSearch.styles", "1ufk1"],
      ["ext.advancedSearch.searchtoken", "1vhat", [], 1],
      ["ext.advancedSearch.elements", "65c2g", [326, 75, 76, 191, 207, 208]],
      ["ext.advancedSearch.init", "bs1xn", [328, 327]],
      ["ext.advancedSearch.SearchFieldUI", "1yx2r", [68, 191]],
      ["mmv", "1lmt2", [10, 14, 27, 75, 336]],
      ["mmv.ui.ondemandshareddependencies", "1ca30", [331, 187]],
      ["mmv.ui.download.pane", "rj6q9", [151, 158, 332]],
      ["mmv.ui.reuse.shareembed", "1hm4h", [158, 332]],
      ["mmv.ui.tipsyDialog", "1vews", [331]],
      ["mmv.bootstrap", "z1np6", [155, 157, 338, 186]],
      ["mmv.bootstrap.autostart", "dgnjl", [336]],
      ["mmv.head", "1vrgu", [67, 76]],
      ["ext.pageforms.main", "8mq0z", [344, 354, 356, 371, 361, 343, 369, 86]],
      ["ext.pageforms.main.styles", "dtb0e"],
      ["ext.pageforms.browser", "1p6a9"],
      ["ext.pageforms.jstree", "a49it", [370]],
      ["ext.pageforms.sortable", "dyin2"],
      ["ext.pageforms.autogrow", "v7l7q"],
      ["ext.pageforms.popupformedit", "16ear", [341]],
      ["ext.pageforms.autoedit", "w555p", [196]],
      ["ext.pageforms.autoeditrating", "cj14x", [196]],
      ["ext.pageforms.submit", "qy9of"],
      ["ext.pageforms.submit.styles", "1eogi"],
      ["ext.pageforms.collapsible", "11glk"],
      ["ext.pageforms.imagepreview", "1en6l"],
      ["ext.pageforms.checkboxes", "1dyv6"],
      ["ext.pageforms.checkboxes.styles", "pfen3"],
      ["ext.pageforms.datepicker", "y7nv5", [370, 161]],
      ["ext.pageforms.timepicker", "617ud"],
      ["ext.pageforms.datetimepicker", "e3jvk", [370, 164]],
      ["ext.pageforms.regexp", "1g7z7"],
      ["ext.pageforms.rating", "10svq", [339]],
      ["ext.pageforms.rating.styles", "mhs8a"],
      ["ext.pageforms.simpleupload", "1hhau"],
      ["ext.pageforms.select2", "17gah", [370, 104]],
      ["ext.pageforms.select2.styles", "twany"],
      ["ext.pageforms.ooui.autocomplete", "1p0ka", [370, 191]],
      ["ext.pageforms.ooui.combobox", "qrzxw", [370, 191]],
      ["ext.pageforms.forminput", "or3ni", [363]],
      ["ext.pageforms.forminput.styles", "15eiu"],
      ["ext.pageforms.fullcalendar", "f3y8k", [342, 361, 29]],
      ["ext.pageforms.spreadsheet", "cvruz", [361, 105, 191, 196, 211, 212]],
      ["ext.pageforms.wikieditor", "1rbb5"],
      ["ext.pageforms", "yxviw"],
      ["ext.pageforms.editwarning", "nb4ex", [25, 42]],
      ["ext.pageforms.PF_CreateProperty", "urc3f"],
      ["ext.pageforms.PF_PageSchemas", "bysnu"],
      ["ext.pageforms.PF_CreateTemplate", "1d1kj", [364]],
      ["ext.pageforms.PF_CreateClass", "y1l8d", [191]],
      ["ext.pageforms.PF_CreateForm", "ev68w", [191]],
      ["ext.pageforms.templatedisplay", "1s6hk"],
      ["ext.jquery.easing", "ug0so"],
      ["ext.jquery.fancybox", "1h7xe", [378, 385]],
      ["ext.jquery.multiselect", "37b3t", [28]],
      ["ext.jquery.multiselect.filter", "edhf1", [380]],
      ["ext.jquery.blockUI", "w0rdm"],
      ["ext.jquery.jqgrid", "yfrg6", [385, 28]],
      ["ext.jquery.flot", "otu1l"],
      ["ext.jquery.migration.browser", "d669y"],
      ["ext.srf", "9j5ii", [499], 3],
      ["ext.srf.styles", "13c3g"],
      ["ext.srf.api", "18xin", [386], 3],
      ["ext.srf.util", "hs8go", [382, 386], 3],
      ["ext.srf.widgets", "z5yo5", [380, 386], 3],
      ["ext.srf.util.grid", "1wc0p", [383, 389], 3],
      ["ext.jquery.sparkline", "1fmyp", [385]],
      ["ext.srf.sparkline", "uvcgr", [392, 389], 3],
      ["ext.dygraphs.combined", "1d87v"],
      ["ext.srf.dygraphs", "tyjuc", [394, 505, 389]],
      ["ext.jquery.listnav", "rf374"],
      ["ext.jquery.listmenu", "nmb55"],
      ["ext.jquery.pajinate", "1sslj"],
      ["ext.srf.listwidget", "157ee", [389]],
      ["ext.srf.listwidget.alphabet", "1jh3r", [396, 399]],
      ["ext.srf.listwidget.menu", "1jh3r", [397, 399]],
      ["ext.srf.listwidget.pagination", "1jh3r", [398, 399]],
      ["ext.jquery.dynamiccarousel", "1xk0w", [385]],
      ["ext.srf.pagewidget.carousel", "y8wz4", [403, 389]],
      ["ext.jquery.jqplot.core", "hynz4", [385]],
      ["ext.jquery.jqplot.excanvas", "53xrq"],
      ["ext.jquery.jqplot.json", "15id4"],
      ["ext.jquery.jqplot.cursor", "185f9"],
      ["ext.jquery.jqplot.logaxisrenderer", "opwgd"],
      ["ext.jquery.jqplot.mekko", "1ftcx"],
      ["ext.jquery.jqplot.bar", "ozpyo", [405]],
      ["ext.jquery.jqplot.pie", "qkq1i", [405]],
      ["ext.jquery.jqplot.bubble", "1d0a8", [405]],
      ["ext.jquery.jqplot.donut", "1kvxq", [412]],
      ["ext.jquery.jqplot.pointlabels", "yt790", [405]],
      ["ext.jquery.jqplot.highlighter", "zi7ne", [405]],
      ["ext.jquery.jqplot.enhancedlegend", "150zk", [405]],
      ["ext.jquery.jqplot.trendline", "1fngo"],
      ["ext.srf.jqplot.themes", "18rc9", [9]],
      ["ext.srf.jqplot.cursor", "1jh3r", [408, 426]],
      ["ext.srf.jqplot.enhancedlegend", "1jh3r", [417, 426]],
      ["ext.srf.jqplot.pointlabels", "1jh3r", [415, 426]],
      ["ext.srf.jqplot.highlighter", "1jh3r", [416, 426]],
      ["ext.srf.jqplot.trendline", "1jh3r", [418, 426]],
      ["ext.srf.jqplot.chart", "15nr1", [405, 419, 389]],
      ["ext.srf.jqplot.bar", "11edd", [411, 425]],
      ["ext.srf.jqplot.pie", "15q3s", [412, 425]],
      ["ext.srf.jqplot.bubble", "sq7p3", [413, 425]],
      ["ext.srf.jqplot.donut", "15q3s", [414, 425]],
      ["ext.smile.timeline.core", "d4y28"],
      ["ext.smile.timeline", "1pyhd"],
      ["ext.srf.timeline", "tpeo4", [431]],
      ["ext.d3.core", "17xla"],
      ["ext.srf.d3.common", "1p3sl", [389]],
      ["ext.d3.wordcloud", "ac42v", [433, 434]],
      ["ext.srf.d3.chart.treemap", "1mig8", [433, 434]],
      ["ext.srf.d3.chart.bubble", "enqu4", [433, 434]],
      ["ext.srf.jquery.progressbar", "kj3nl"],
      ["ext.srf.jit", "ny3gt"],
      ["ext.srf.jitgraph", "1ohm9", [439, 438]],
      ["ext.jquery.jcarousel", "tkcj4", [385]],
      ["ext.jquery.responsiveslides", "8mbn9"],
      ["ext.srf.formats.gallery", "xzjqt", [389]],
      ["ext.srf.gallery.carousel", "lbj6g", [441, 443]],
      ["ext.srf.gallery.slideshow", "1jz1o", [442, 443]],
      ["ext.srf.gallery.overlay", "3hp9u", [379, 443]],
      ["ext.srf.gallery.redirect", "1hbzc", [443]],
      ["ext.jquery.fullcalendar", "slkpc"],
      ["ext.jquery.gcal", "18xst"],
      ["ext.srf.widgets.eventcalendar", "5w6x2", [505, 388, 389, 28]],
      ["ext.srf.hooks.eventcalendar", "11s5c", [386]],
      ["ext.srf.eventcalendar", "35s02", [448, 451, 450]],
      ["ext.srf.filtered", "zzbth", [386]],
      ["ext.srf.filtered.calendar-view.messages", "1qfun"],
      ["ext.srf.filtered.calendar-view", "t47v9", [448, 454]],
      ["ext.srf.filtered.map-view.leaflet", "14hjl"],
      ["ext.srf.filtered.map-view", "647q6"],
      ["ext.srf.filtered.value-filter", "6bva1"],
      ["ext.srf.filtered.value-filter.select", "1jpwq"],
      ["ext.srf.filtered.slider", "op6m2"],
      ["ext.srf.filtered.distance-filter", "oenx4", [460]],
      ["ext.srf.filtered.number-filter", "14oum", [460]],
      ["ext.srf.slideshow", "5n3o9", [78]],
      ["ext.jquery.tagcanvas", "160dz"],
      ["ext.srf.formats.tagcloud", "2yhlp", [389]],
      ["ext.srf.flot.core", "1v6c4"],
      ["ext.srf.timeseries.flot", "14o3a", [384, 466, 389]],
      ["ext.jquery.jplayer", "ybrrs"],
      ["ext.jquery.jplayer.skin.blue.monday", "i42nl"],
      ["ext.jquery.jplayer.skin.morning.light", "80bjl"],
      ["ext.jquery.jplayer.playlist", "fh2gr", [468]],
      ["ext.jquery.jplayer.inspector", "1476m", [468]],
      ["ext.srf.template.jplayer", "12xe6", [386]],
      ["ext.srf.formats.media", "lf29e", [471, 473], 3],
      ["jquery.dataTables", "16q25"],
      ["jquery.dataTables.extras", "1vfoo"],
      ["ext.srf.carousel.module", "1gknt"],
      ["ext.srf.carousel", "bd7gn", [388, 389, 390]],
      ["ext.srf.datatables.v2.format", "rl1n5", [388, 480, 389, 390, 81, 191]],
      ["ext.srf.datatables.v2.module", "12glz"],
      ["ext.srf.gantt", "15gux", ["ext.mermaid"]],
      ["ext.smw", "hisx5", [492]],
      ["ext.smw.style", "12g7f"],
      ["ext.smw.special.styles", "vtky5"],
      ["smw.ui", "piij5", [482, 489]],
      ["smw.ui.styles", "7rsyj"],
      ["smw.summarytable", "5vj5c"],
      ["ext.smw.special.style", "ckyko"],
      ["jquery.selectmenu", "1uxct", [490]],
      ["jquery.selectmenu.styles", "7rsyj"],
      ["jquery.jsonview", "ceitl"],
      ["ext.jquery.async", "qr6m6"],
      ["ext.jquery.jStorage", "8w5kh"],
      ["ext.jquery.md5", "7ug0c"],
      ["ext.smw.dataItem", "1igie", [482, 68, 75]],
      ["ext.smw.dataValue", "1enmx", [495]],
      ["ext.smw.data", "1e89a", [496]],
      ["ext.smw.query", "e6uxt", [482, 78]],
      ["ext.smw.api", "qkm8k", [493, 494, 497, 498]],
      ["ext.jquery.autocomplete", "1fdii"],
      ["ext.jquery.qtip.styles", "1h36w"],
      ["ext.jquery.qtip", "1r6qg"],
      ["ext.smw.tooltip.styles", "658we"],
      ["ext.smw.tooltip.old", "1ife2", [502, 482, 503]],
      ["ext.smw.tooltip", "1jh3r", [503, 545]],
      ["ext.smw.tooltips", "1jh3r", [483, 545]],
      ["ext.smw.autocomplete", "9dnah", ["jquery.ui.autocomplete"]],
      ["ext.smw.purge", "8ogn2", [40]],
      ["ext.smw.vtabs.styles", "1q8a2"],
      ["ext.smw.vtabs", "b5kxk"],
      ["ext.smw.modal.styles", "1owc0"],
      ["ext.smw.modal", "1c6nq"],
      ["smw.special.search.styles", "1juck"],
      ["smw.special.search", "13fd1", [485]],
      ["ext.smw.postproc", "1vpxt", [40]],
      ["ext.jquery.caret", "qybij"],
      ["ext.jquery.atwho", "3as6s", [516]],
      ["ext.smw.suggester", "1its3", [517, 482]],
      ["ext.smw.suggester.textInput", "1t0ic", [518]],
      ["ext.smw.autocomplete.page", "baynw", [500, 78]],
      ["ext.smw.autocomplete.property", "aq8ep", [500, 78]],
      ["ext.smw.ask.styles", "r4efe"],
      ["ext.smw.ask", "140pb", [522, 483, 518, 505]],
      ["ext.smw.table.styles", "vg852"],
      ["ext.smw.browse.styles", "1096v"],
      ["ext.smw.browse", "1nmou", [483, 40]],
      ["ext.smw.browse.autocomplete", "1jh3r", [520, 526]],
      ["ext.smw.admin", "2fdlc", [40, 543]],
      ["smw.special.facetedsearch.styles", "glgfy"],
      ["smw.special.facetedsearch", "1kao8", [548, 529]],
      ["ext.smw.personal", "3w54x", [505]],
      ["smw.tableprinter.datatable", "t062g", [498, 551]],
      ["smw.tableprinter.datatable.styles", "aprre"],
      ["ext.smw.deferred.styles", "13upk"],
      ["ext.smw.deferred", "13r8d", [552, 548]],
      ["ext.smw.page.styles", "17g5c"],
      ["smw.property.page", "hx6jv", [505, 552, 543]],
      ["smw.content.schema", "12b2c"],
      ["smw.factbox", "1cwfl"],
      ["smw.content.schemaview", "e3ebu", [543]],
      ["jquery.mark.js", "23efe"],
      ["smw.jsonview.styles", "1blxk"],
      ["smw.jsonview", "16f25", [482, 491, 541]],
      ["ext.libs.tippy", "1walh"],
      ["smw.tippy", "11f4x", [544, 482, 40]],
      ["smw.entityexaminer", "1l5uf", [545]],
      ["onoi.qtip", "gmxxr"],
      ["onoi.rangeslider", "tl62p"],
      ["onoi.blobstore", "18xy8"],
      ["onoi.clipboard", "19o8k"],
      ["onoi.dataTables", "1tyd3"],
      ["mediawiki.api.parse", "1jh3r", [40]],
      ["ext.echo.emailicons", "87j1f"],
      ["ext.echo.secondaryicons", "scsm0"],
      ["ext.pageforms.maps", "13fy8", [209]],
      ["ext.confirmEdit.CaptchaInputWidget", "15usq", [188]],
      ["mediawiki.messagePoster", "13b1w", [49]]
    ]);
    mw.config.set(window.RLCONF || {});
    mw.loader.state(window.RLSTATE || {});
    mw.loader.load(window.RLPAGEMODULES || []);
    queue = window.RLQ || [];
    RLQ = [];
    RLQ.push = function(fn) {
      if (typeof fn === 'function') {
        fn();
      } else {
        RLQ[RLQ.length] = fn;
      }
    };
    while (queue[0]) {
      RLQ.push(queue.shift());
    }
    NORLQ = {
      push: function() {}
    };
  }());
}