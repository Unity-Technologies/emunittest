// emtimer.js, emunittest testing harness script.
// This script makes rAF() animation runs deterministic, useful replaying identical runs for benchmarking.

var emtimerOptions = (typeof emtimerOptions !== 'undefined') ? emtimerOptions : (typeof Module !== 'undefined' ? Module : {});

var enableCpuProfiler = (location.search.indexOf('cpuprofiler') != -1);

// If an error occurs on the page, fast-quit execution and return to harness with an error.
window.onerror = function(msg, url, line, column, e) {
  console.error('window.onerror: msg: ' + msg + ', url: ' + url + ', line: ' + line + ', column: ' + column + ', e: ' + e);
  if (msg.indexOf("InvalidStateError") != -1 || msg.indexOf("QuotaExceededError") != -1) {
    // First error occurs when running Firefox profiles in different Firefox flavors (safe to ignore),
    // second one if attempting to store files to IndexedDB cache when there's not enough space (also safe to ignore)
    return;
  }
  // window.opener points to the test harness window if one exists. If a test page is opened outside the harness, window.opener
  // does not exist and as a result we don't auto-close on error (but show the error to user).
  // Also ignore InvalidStateError errors because those can occur in IndexedDB operations from file:// URLs, which we don't really care about.
  var testResults = null;
  if (msg == 'uncaught exception: exit') { // Normal exit from test
    var timeEnd = performance.realNow();
    var totalTime = timeEnd - pageStartupT0; // Total time, including everything.
    var totalRenderTime = timeEnd - emtimerOptions['timeStart'];
    var cpuIdle = accumulatedCpuIdleTime * 100.0 / totalRenderTime;
    var fps = numFramesToRender * 1000.0 / totalRenderTime;
    testResults = {
      result: 'PASS',
      numRenderedFrames: numFramesToRender,
      totalTime: totalTime,
      totalRenderTime: totalRenderTime,
      wrongPixels: 0,
      webGLCpuTime: typeof emscriptenCpuProfiler !== 'undefined' && emscriptenCpuProfiler.sections && emscriptenCpuProfiler.sections[0] && emscriptenCpuProfiler.sections[1] ? (emscriptenCpuProfiler.sections[0].overallTimeInSection + emscriptenCpuProfiler.sections[1].overallTimeInSection) : 0,
      webGLApiCallCount: typeof emscriptenCpuProfiler !== 'undefined' && emscriptenCpuProfiler.sections && emscriptenCpuProfiler.sections[0] && emscriptenCpuProfiler.sections[1] ? (emscriptenCpuProfiler.sections[0].visitedCount + emscriptenCpuProfiler.sections[1].visitedCount) : 0,
      cpuTime: accumulatedCpuTime,
      cpuIdle: cpuIdle,
      fps: 0,
      pageLoadTime: pageLoadTime,
      numStutterEvents: 0,
      usedJsMemory: typeof performance !== 'undefined' && performance.memory ? performance.memory.usedJSHeapSize : 0
    };
  } else {
    testResults = {
      result: 'ERROR',
      error: msg
    };
  }
  top.postMessage({ msg: 'stopGame', key: emtimerOptions.key, result: testResults }, '*');

  unloadAllEventHandlers();
  if (window.opener && injectingInputStream) {
    window.opener.postMessage(testResults, "*");
    window.close();
  }
}

// If true, the page is run in a record mode where user interactively runs the page, and input stream is captured. Use this in
// when authoring new tests to the suite.
var recordingInputStream = location.search.indexOf('record') != -1;

// If true, we are autoplaybacking a recorded input stream. If false, input is not injected (we are likely running in an interactive examination mode of a test)
var injectingInputStream = location.search.indexOf('playback') != -1;

// Allow disabling audio altogether on the page to enable profiling what kind of performance/correctness effect it may have on execution.
var disableAudio = location.search.indexOf('noaudio') != -1;
emtimerOptions['disableAudio'] = disableAudio;

// In test mode (injectingInputStream == true), we always render this many fixed frames, after which the test is considered finished.
// ?numframes=number GET parameter can override custom test length.
var numFramesToRender = emtimerOptions['overrideNumFramesToRender'] || emtimerOptions['numFramesToRender'] || 2000;

if (location.search.indexOf('numframes=') != -1) {
  numFramesToRender = parseInt(location.search.substring(location.search.indexOf('numframes=') + 'numframes='.length));
}

// Currently executing frame.
var referenceTestFrameNumber = 0;

// Guard against recursive calls to referenceTestPreTick+referenceTestTick from multiple rAFs.
var referenceTestPreTickCalledCount = 0;

// Wallclock time denoting when the page has finished loading.
var pageLoadTime = null;

// Tallies up the amount of CPU time spent in the test.
var accumulatedCpuTime = 0;

// Some tests need to receive a monotonously increasing time counter, but can't pass real wallclock time, which would make the test timing-dependent, so instead
// craft an arbitrary increasing counter.
var fakedTime = 0;

// Tracks when Emscripten runtime has been loaded up. (main() called)
var emtimerRuntimeInitialized = 0;

// Keeps track of performance stutter events. A stutter event occurs when there is a hiccup in subsequent per-frame times. (fast followed by slow)
var numStutterEvents = 0;

// Measure a "time until smooth frame rate" quantity, i.e. the time after which we consider the startup JIT and GC effects to have settled.
// This field tracks how many consecutive frames have run smoothly. This variable is set to -1 when smooth frame rate has been achieved to disable tracking this further.
var numConsecutiveSmoothFrames = 0;

const numFastFramesNeededForSmoothFrameRate = 120; // Require 120 frames i.e. ~2 seconds of consecutive smooth stutter free frames to conclude we have reached a stable animation rate.

var registeredEventListeners = [];

// Don't call any application page unload handlers as a response to window being closed.
function ensureNoClientHandlers() {
  // This is a bit tricky to manage, since the page could register these handlers at any point,
  // so keep watching for them and remove them if any are added. This function is called multiple times
  // in a semi-polling fashion to ensure these are not overridden.
  if (window.onbeforeunload) window.onbeforeunload = null;
  if (window.onunload) window.onunload = null;
  if (window.onblur) window.onblur = null;
  if (window.onfocus) window.onfocus = null;
  if (window.onpagehide) window.onpagehide = null;
  if (window.onpageshow) window.onpageshow = null;
}

function unloadAllEventHandlers() {
  for(var i in registeredEventListeners) {
    var l = registeredEventListeners[i];
    l[0].removeEventListener(l[1], l[2], l[3]);
  }
  registeredEventListeners = [];

  // Make sure no XHRs are being held on to either.
  preloadedXHRs = {};
  numPreloadXHRsInFlight = 0;
  XMLHttpRequest = realXMLHttpRequest;

  ensureNoClientHandlers();
}

// Mock performance.now() and Date.now() to be deterministic.
// Unfortunately looks like there does not exist a good feature test for this, so resort to user agent sniffing.. (sad :/)
if (!performance.realNow) {
  var isSafari = /^((?!chrome|android).)*safari/i.test(navigator.userAgent);
  if (isSafari) {
    realPerformance = performance;
    performance = {
      realNow: function() { return realPerformance.now(); },
      now: function() { return realPerformance.now(); }
    };
  } else {
    performance.realNow = performance.now;
  }
}

RealDate = Date;
class MockDate {
  constructor(t) {
    this.t = t;
  }

  static now() {
    return fakedTime * 1000.0 * timeScale / 60.0;
  }

  static realNow() {
    return RealDate.now();
  }

  getTimezoneOffset() {
    return 0;
  }

  toTimeString() {
    return '';
  }

  getDate() { return 0; }
  getDay() { return 0; }
  getFullYear() { return 0; }
  getHours() { return 0; }
  getMilliseconds() { return 0; }
  getMonth() { return 0; }
  getMinutes() { return 0; }
  getSeconds() { return 0; }
  getTime() { return 0; }
  getYear() { return 0; }

  static UTC() { return 0; }

  getUTCDate() { return 0; }
  getUTCDay() { return 0; }
  getUTCFullYear() { return 0; }
  getUTCHours() { return 0; }
  getUTCMilliseconds() { return 0; }
  getUTCMonth() { return 0; }
  getUTCMinutes() { return 0; }
  getUTCSeconds() { return 0; }

  setDate() {}
  setFullYear() {}
  setHours() {}
  setMilliseconds() {}
  setMinutes() {}
  setMonth() {}
  setSeconds() {}
  setTime() {}

  setUTCDate() {}
  setUTCFullYear() {}
  setUTCHours() {}
  setUTCMilliseconds() {}
  setUTCMinutes() {}
  setUTCMonth() {}

  setYear() {}
}

if (injectingInputStream || recordingInputStream) {
  if (!emtimerOptions['dontOverrideTime']) {
    Date = MockDate;
    var timeScale = (typeof emtimerOptions['fakeTimeScale'] !== 'undefined') ? emtimerOptions['fakeTimeScale'] : 1.0;
    if (emtimerOptions['needsFakeMonotonouslyIncreasingTimer']) {
      Date.now = function() { fakedTime += timeScale; return fakedTime; }
      performance.now = function() { fakedTime += timeScale; return fakedTime; }
    } else {
      Date.now = function() { return fakedTime * 1000.0 * timeScale / 60.0; }
      performance.now = function() { return fakedTime * 1000.0 * timeScale / 60.0; }
    }
  }
  // This is an unattended run, don't allow window.alert()s to intrude.
  window.alert = function(msg) { console.error('window.alert(' + msg + ')'); }
  window.confirm = function(msg) { console.error('window.confirm(' + msg + ')'); return true; }

  // Replace Math.random() Custom LCG to be able to deterministically seed the random number generator.
  var randomState = 1;
  Math.random = function() {
    randomState = (((((1103515245 * randomState)>>>0) + 12345) >>> 0) % 0x80000000)>>>0;
    return randomState / 0x80000000;
  }
}

// Different browsers have different precision with Math functions. Therefore
// reduce precision to lowest common denominator.
function injectMathFunc(f) {
  var rf = 'real_' + f;
  Math[rf] = Math[f];
  switch(Math[f].length) {
    case 1: Math[f] = function(a1) { return Math.ceil(Math[rf](a1) * 10000) / 10000; }; break;
    case 2: Math[f] = function(a1, a2) { return Math.ceil(Math[rf](a1, a2) * 10000) / 10000; }; break;
    default: throw 'Failed to hook into Math!';
  }
}

if (emtimerOptions['injectMathFunctions'] && (recordingInputStream || injectingInputStream)) {
  var mathFuncs = ['acos', 'acosh', 'asin', 'asinh', 'atan', 'atanh', 'atan2', 'cbrt', 'cos', 'cosh', 'exp', 'expm1', 'log', 'log1p', 'log10', 'log2', 'pow', 'sin', 'sinh', 'sqrt', 'tan', 'tanh'];
  for(var i in mathFuncs) injectMathFunc(mathFuncs[i]);
}

var realXMLHttpRequest = XMLHttpRequest;

// dictionary with 'responseType|url' -> finished XHR object mappings.
var preloadedXHRs = {};
var preloadXHRProgress = {};
var numStartupBlockerXHRsPending = 0; // The number of XHRs active that the game needs to load up before the test starts.
var numPreloadXHRsInFlight = 0; // The number of XHRs still active, via calls from preloadXHR().

var siteRoot = '';

function totalProgress() {
  var bytesLoaded = 0;
  var bytesTotal = 0;
  for(var i in preloadXHRProgress) {
    var x = preloadXHRProgress[i];
    if (x.bytesTotal > 0) {
      bytesLoaded += x.bytesLoaded;
      bytesTotal += x.bytesTotal;
    }
  }
  if (emtimerOptions['demoAssetSizeInBytes']) {
    if (bytesTotal > emtimerOptions['demoAssetSizeInBytes']) {
      console.error('Game downloaded ' + bytesTotal + ' bytes, expected demo size was only ' + emtimerOptions['demoAssetSizeInBytes'] + '!');
      emtimerOptions['demoAssetSizeInBytes'] = bytesTotal;
    }
    bytesTotal = emtimerOptions['demoAssetSizeInBytes'];
  }
  if (bytesTotal == 0) return 1.0;
  return Math.min(1.0, bytesLoaded / bytesTotal);
}

// Use IndexedDB for caching, and kill IndexedDB from the site in question so that it doesn't persist savegame/progress data
// which might make subsequent runs different.
var realIndexedDB = window.indexedDB || window.mozIndexedDB || window.webkitIndexedDB || window.msIndexedDB;

function openDatabase(dbname, dbversion, callback, errback) {
  try { var openRequest = realIndexedDB.open(dbname, dbversion);
  } catch (e) { return errback(e); }

  openRequest.onupgradeneeded = function(event) {
    var db = event.target.result;
    if (db.objectStoreNames.contains('FILES')) db.deleteObjectStore('FILES');
    db.createObjectStore('FILES');
  };
  openRequest.onsuccess = function(event) { callback(event.target.result); };
  openRequest.onerror = function(error) { errback(error);};
};

function fetchCachedPackage(db, packageName, callback, errback) {
  if (!db) {
    errback('IndexedDB not available!');
    return;
  }
  try {
    var transaction = db.transaction(['FILES'], 'readonly');
    var packages = transaction.objectStore('FILES');
    var getRequest = packages.get("file/" + emtimerOptions.key + '/' + packageName);
    getRequest.onsuccess = function(event) {
      if (event.target.result) {
        var len = event.target.result.byteLength || event.target.result.length;
        console.log('Loaded file ' + packageName + ' from IndexedDB cache, length: ' + len);
        callback(event.target.result);
      } else {
        // Succeeded to load, but the load came back with the value of undefined, treat that as an error since we never store undefined in db.
        errback();
      }
    };
    getRequest.onerror = function(error) { errback(error); };
  } catch(e) {
    errback(e);
  }
};

function cacheRemotePackage(db, packageName, packageData, callback, errback) {
  if (!db) {
    errback('cacheRemotePackage: IndexedDB not available!');
    return;
  }
  if (location.protocol.indexOf('file') != -1) {
    errback('Loading via file://, skipping caching to IndexedDB');
    return;
  }
  try {
    var transaction = db.transaction(['FILES'], 'readwrite');
    var packages = transaction.objectStore('FILES');
    var putRequest = packages.put(packageData, "file/" + emtimerOptions.key + '/' + packageName);
    putRequest.onsuccess = function(event) {
      console.log('Stored file ' + packageName + ' to IndexedDB cache.');
      callback(packageName);
    };
    putRequest.onerror = function(error) {
      console.error('Failed to store file ' + packageName + ' to IndexedDB cache!');
      errback(error);
    };
  } catch(e) {
    errback(e);
  }
};

// Async operations that are waiting for the IndexedDB to become available.
idbOpenListeners = [];
var isIdbOpen = undefined; // undefined = not yet tried, false = tried but failed to open, true = available
var dbInstance = undefined;

function idbOpened(db) {
  dbInstance = db;
  isIdbOpen = true;
  for(var i in idbOpenListeners) {
    idbOpenListeners[i](db);
  }
  idbOpenListeners = [];
}
function idbError(e) {
  isIdbOpen = false;
  for(var i in idbOpenListeners) {
    idbOpenListeners[i](null);
  }
  idbOpenListeners = [];
}

var isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);

var injectXMLHttpRequests = emtimerOptions['injectXMLHttpRequests'] && !isMobile;
if (injectXMLHttpRequests) {
  openDatabase(emtimerOptions.xhrCacheName || 'xhrCache', emtimerOptions.xhrCacheVersion || 3, idbOpened, idbError);
}

function withIndexedDb(func) {
  if (isIdbOpen !== undefined) func(dbInstance);
  else idbOpenListeners.push(func);
}

// dbName: The IndexedDB database name to delete. Default: 'xhrCache'
function clearIndexedDBCache(dbName, onsuccess, onerror, onblocked) {
  if (dbInstance) dbInstance.close();
  if (!dbName) dbName = 'xhrCache';
  var req = realIndexedDB.deleteDatabase(dbName);
  req.onsuccess = function() { console.log('Deleted IndexedDB cache ' + dbName + '!'); if (onsuccess) onsuccess(); }
  req.onerror = function() { console.error('Failed to delete IndexedDB cache ' + dbName + '!'); if (onerror) onerror(); }
  req.onblocked = function() { console.error('Failed to delete IndexedDB cache ' + dbName + ', DB was blocked!'); if (onblocked) onblocked(); }
}

// E.g. use the following function to load one by one (or do it somewhere else and set preloadedXHRs object)
// startupBlocker: If true, then this preload XHR is one without which the reftest game time should not progress. This is used to exclude the time
//                 that the game waits for the network to not count towards the test time.
function preloadXHR(url, responseType, onload, startupBlocker) {
  if (startupBlocker) ++numStartupBlockerXHRsPending; // Used to detect when game time should start.
  ++numPreloadXHRsInFlight; // Used to detect when the last preload XHR has finished and the game loading can start.
  top.postMessage({ msg: 'preloadGame', key: emtimerOptions.key }, '*');

  function finished(xhrOrData) {
    if (xhrOrData instanceof realXMLHttpRequest) preloadedXHRs[responseType + '_' + url] = xhrOrData;
    else preloadedXHRs[responseType + '_' + url] = {
      response: xhrOrData,
      responseText: xhrOrData,
      status: 200,
      readyState: 4,
      responseURL: url,
      statusText: "200 OK",
      getAllResponseHeaders: function() { return "" },
    };
    preloadedXHRs[responseType + '_' + url].startupBlocker = startupBlocker;

    var len = preloadedXHRs[responseType + '_' + url].response.byteLength || preloadedXHRs[responseType + '_' + url].response.length;
    preloadXHRProgress[responseType + '_' + url] = {
      bytesLoaded: len,
      bytesTotal: len
    };
    top.postMessage({ msg: 'preloadProgress', key: emtimerOptions.key, progress: totalProgress() }, '*');

    if (onload) onload();
    // Once all XHRs are finished, trigger the page to start running.
    if (--numPreloadXHRsInFlight == 0) {
      console.log('All preload XHRs finished!');
      window.postMessage('preloadXHRsfinished', '*');
    }
  }

  function idbFailed() {
    var xhr = new realXMLHttpRequest();
    xhr.open('GET', url, true);
    xhr.responseType = responseType;
    xhr.onprogress = function(evt) {
      if (evt.lengthComputable) {
        preloadXHRProgress[responseType + '_' + url] = { bytesLoaded: evt.loaded, bytesTotal: evt.total};
        top.postMessage({ msg: 'preloadProgress', key: emtimerOptions.key, progress: totalProgress() }, '*');
      }
    }
    xhr.onload = function() {
      console.log('preloaded XHR ' + url + ' finished!');

      // If the transfer fails, then immediately fire the onload handler, and don't event attempt to cache.
      if ((xhr.status != 200 && xhr.status != 0) || (!xhr.response || !(xhr.response.byteLength || xhr.response.length))) {
        finished(xhr);
      } else {
        // Store the downloaded data to IndexedDB cache.
        withIndexedDb(function(db) {
          function storeFinished() {
            finished(xhr);
          }
          cacheRemotePackage(db, url, xhr.response, storeFinished, storeFinished);
        });
      }
    }
    xhr.send();
  }

  withIndexedDb(function(db) {
    fetchCachedPackage(db, url, finished, idbFailed);
  });
}

if (!emtimerOptions['providesRafIntegration'] || enableCpuProfiler) {
  if (!window.realRequestAnimationFrame) {
    window.realRequestAnimationFrame = window.requestAnimationFrame;
    window.requestAnimationFrame = function(cb) {
      if (numStartupBlockerXHRsPending == 0) onRuntimeInitialized();
      function hookedCb(p) {
        if (typeof Module !== 'undefined' && !Module['TOTAL_MEMORY'] && Module['preMainLoop']) Module['preMainLoop'](); // If we are running a non-Emscripten app, pump pre/post main loop handlers for cpu profiler (Module.TOTAL_MEMORY hints if this was Emscripten or not)
        referenceTestPreTick();
        cb(performance.now());
        referenceTestTick();
        if (typeof Module !== 'undefined' && !Module['TOTAL_MEMORY'] && Module['postMainLoop']) Module['postMainLoop']();
      }
      return window.realRequestAnimationFrame(hookedCb);
    }
  }
}

// Hook into XMLHTTPRequest to be able to submit preloaded requests.
if (injectXMLHttpRequests) {
  XMLHttpRequest = function() {}
  XMLHttpRequest.prototype = {
    open: function(method, url, async) {
      // Don't yet do anything except store the params, since we don't know
      // whether we need to open a real XHR, or if we have a cached one waiting
      // (need the .responseType field for this)
      this.url_ = url;
      this.method_ = method;
      this.async_ = async;
    },

    send: function(data) {
      var this_ = this;
      var xhrKey = this_.responseType_ + '_' + this_.url_;
      this_.xhr_ = preloadedXHRs[xhrKey];
      if (!this.xhr_) {
        var base = document.getElementsByTagName('base');
        if (base.length > 0 && base[0].href) {
          var baseHref = document.getElementsByTagName('base')[0].href;
          var xhrKey = this_.responseType_ + '_' + baseHref + this_.url_;
          if (preloadedXHRs[xhrKey]) this_.xhr_ = preloadedXHRs[xhrKey];
        }
      }
        
      if (this.xhr_) {
        // This particular XHR URL has been downloaded up front. Serve the preloaded one.
        setTimeout(function() {
          if (this_.onprogress) this_.onprogress({ loaded: this_.response.length, total: this_.response.length });
          if (this_.onload) this_.onload();

          // Free up reference to this XHR to not leave behind used memory.
          try {
            if (preloadedXHRs[xhrKey].startupBlocker) --numStartupBlockerXHRsPending;
            delete preloadedXHRs[xhrKey];
          } catch(e) {}
        }, 1);
      } else {
        // To keep the execution coherent for the current set of demos, kill certain outbound XHRs so they don't stall the run.
        if (typeof emtimerOptions['xhrFilter'] === 'function' && emtimerOptions['xhrFilter'](this.url_)) return;

        // Attempt to download the asset from IndexedDB cache.
        function idbSuccess(data) {
          this_.xhr_ = {
            response: data,
            responseText: data,
            status: 200,
            readyState: 4,
            responseURL: this_.url_,
            statusText: "200 OK",
            getAllResponseHeaders: function() { return "" },
          };
          var len = data.byteLength || data.length;
          preloadXHRProgress[this_.responseType_ + '_' + this_.url_] = { bytesLoaded: len, bytesTotal: len };
          top.postMessage({ msg: 'preloadProgress', key: emtimerOptions.key, progress: totalProgress() }, '*');
          if (this_.onprogress) {
            var len = data.byteLength || data.length;
            this_.onprogress({ loaded: len, total: len });
          }
          if (this_.onreadystatechange) this_.onreadystatechange();
          if (this_.onload) this_.onload();
        };
        function idbFail() {
          // The XHR has not been cached up in advance. Log a trace and do it now on demand.
          this_.xhr_ = new realXMLHttpRequest();
          this_.xhr_.onprogress = function(evt) {
            if (evt.lengthComputable) {
              preloadXHRProgress[this_.responseType_ + '_' + this_.url_] = { bytesLoaded: evt.loaded, bytesTotal: evt.total};
              top.postMessage({ msg: 'preloadProgress', key: emtimerOptions.key, progress: totalProgress() }, '*');
            }
            if (this_.onprogress) this_.onprogress(evt);
          }
          if (this_.responseType_) this_.xhr_.responseType = this_.responseType_;
          this_.xhr_.open(this_.method_, this_.url_, this_.async_);
          this_.xhr_.onload = function() {
            if (preloadXHRProgress[this_.responseType_ + '_' + this_.url_]) preloadXHRProgress[this_.responseType_ + '_' + this_.url_].bytesLoaded = preloadXHRProgress[this_.responseType_ + '_' + this_.url_].bytesTotal;

            // If the transfer fails, then immediately fire the onload handler, and don't event attempt to cache.
            if ((this_.xhr_.status != 200 && this_.xhr_.status != 0) || (!this_.xhr_.response || !(this_.xhr_.response.byteLength || this_.xhr_.response.length))) {
              if (this_.onload) this_.onload();
            } else {
              // Store the downloaded data to IndexedDB cache.
              function onStored() {
                if (this_.onload) this_.onload();
              }
              withIndexedDb(function(db) {
                cacheRemotePackage(db, this_.url_, this_.xhr_.response, onStored, onStored);
              });
            }
          }
          this_.xhr_.send();
        };
        withIndexedDb(function(db) {
          fetchCachedPackage(db, this_.url_, idbSuccess, idbFail);
        });
      }
    },

    getAllResponseHeaders: function() { return this.xhr_.getAllResponseHeaders(); },
    setRequestHeader: function(h, v) { },
    addEventListener: function(s, f) { console.log(s); },
    get response() { return this.xhr_.response; },
    get responseText() { return this.xhr_.responseText; },
    get responseXML() { return this.xhr_.responseXML; },
    get responseType() { return this.responseType_; },
    set responseType(x) { this.responseType_ = x; },
    get status() { return this.xhr_.status; },
    get statusText() { return this.xhr_.statusText; },
    get timeout() { return this.xhr_.timeout; }
  };
}

// XHRs in the expected render output image, always 'reference.png' in the root directory of the test.
function loadReferenceImage() {
  var img = new Image();
  img.src = emtimerOptions['reftestURL'] || 'reference.png';
  // reference.png might come from a different domain than the canvas, so don't let it taint ctx.getImageData().
  // See https://developer.mozilla.org/en-US/docs/Web/HTML/CORS_enabled_image
  img.crossOrigin = 'Anonymous'; 
  img.onload = function() {
    var canvas = document.createElement('canvas');
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    canvas.style.width = (img.naturalWidth / window.devicePixelRatio) + 'px';
    canvas.style.height = (img.naturalHeight / window.devicePixelRatio) + 'px';
    var ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0);
    emtimerOptions['referenceImageData'] = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
  }
  emtimerOptions['referenceImage'] = img;
}

// This function can be called from the test code to report any custom test result scores. These will then
// be reported out to the test harness.
var customTestBlocks = {};
function emunittestReportCustomBlockDuration(blockName, blockDuration) {
  if (typeof blockDuration === 'string' && blockDuration[0] === '+') {
    if (!customTestBlocks[blockName]) customTestBlocks[blockName] = 0;
    customTestBlocks[blockName] += parseFloat(blockDuration.substr(1));
  } else {
    customTestBlocks[blockName] = parseFloat(blockDuration);
  }
}

// Performs the per-pixel rendering comparison test.
function doReferenceTest() {
  var canvas;
  // Find Emscripten-specific location of the GL context that the page has been rendering to.
  if (typeof GLctx !== 'undefined') canvas = GLctx.canvas;
  else if (emtimerOptions.ctx) canvas = emtimerOptions.ctx.canvas;
  else if (emtimerOptions['canvas']) canvas = emtimerOptions['canvas'];
  else if (typeof Module !== 'undefined' && Module.ctx) canvas = Module.ctx.canvas;
  else if (typeof Module !== 'undefined' && Module['canvas']) canvas = Module['canvas'];
  else {
    canvas = document.querySelector('canvas');
    if (!canvas) throw 'Cannot find application canvas!';
  }

  // Grab rendered WebGL front buffer image to a JS-side image object.
  var actualImage = new Image();

  function reftest() {
    var timeEnd = performance.realNow();
    var totalTime = timeEnd - pageStartupT0; // Total time, including everything.
    var totalRenderTime = timeEnd - emtimerOptions['timeStart'];
    var cpuIdle = accumulatedCpuIdleTime * 100.0 / totalRenderTime;
    var fps = numFramesToRender * 1000.0 / totalRenderTime;
    var wrong = Infinity;
    var testResult = 'FAIL';

    // Check if we never reached a stable frame rate?
    if (numConsecutiveSmoothFrames != -1) emunittestReportCustomBlockDuration('timeUntilSmoothFramerate', Infinity);

    try {
      var div = document.createElement('div');

      var pixelWidth = canvas.width;
      var pixelHeight = canvas.height;
      actualImage.width = pixelWidth / window.devicePixelRatio;
      actualImage.height = pixelHeight / window.devicePixelRatio;

      var actualCanvas = document.createElement('canvas');
      actualCanvas.width = pixelWidth;
      actualCanvas.height = pixelHeight;
      actualCanvas.style.width = actualImage.width + 'px';
      actualCanvas.style.height = actualImage.height + 'px';
      var actualCtx = actualCanvas.getContext('2d');
      actualCtx.drawImage(actualImage, 0, 0);
      var actual = actualCtx.getImageData(0, 0, pixelWidth, pixelHeight).data;

      var fakegl = (location.search.indexOf('fakegl') != -1);

      var wrong = 0;
      if (emtimerOptions['refTest'] && !fakegl) {
        var img = emtimerOptions['referenceImage'];
        img.style.width = actualImage.width + 'px';
        img.style.height = actualImage.height + 'px';

        var total = 0;
        var expected = emtimerOptions['referenceImageData'];
        // Compute per-pixel error diff.
        for (var x = 0; x < pixelWidth; x++) {
          for (var y = 0; y < pixelHeight; y++) {
            total += Math.abs(expected[y*pixelWidth*4 + x*4 + 0] - actual[y*pixelWidth*4 + x*4 + 0]);
            total += Math.abs(expected[y*pixelWidth*4 + x*4 + 1] - actual[y*pixelWidth*4 + x*4 + 1]);
            total += Math.abs(expected[y*pixelWidth*4 + x*4 + 2] - actual[y*pixelWidth*4 + x*4 + 2]);
          }
        }

        wrong = Math.floor(total / (pixelWidth*pixelHeight*3)); // floor, to allow some margin of error for antialiasing
      }

      // Hide all other elements on the page, only show the expected and observed rendered images.
      var cn = document.body.childNodes;
      for(var i = 0; i < cn.length; ++i) {
        if (cn[i] && cn[i].style && cn[i].id != 'cpuprofiler_container') cn[i].style.display = 'none';
      }

      if (wrong < 10) { // Allow a bit of leeway.
        if (fakegl) {
          testResult = 'PASS (no per-pixel test - fakegl mode)';
        } else {
          testResult = 'PASS';
        }
        div.innerHTML = 'TEST PASSED. Timescore: ' + totalRenderTime.toFixed(3) + ' msecs. (lower is better)<pre id="testResults"></pre>';
        div.style.color = 'green';
        document.body.appendChild(div);
        document.body.appendChild(actualImage); // to grab it for creating the test reference
      } else {
        testResult = 'FAIL';
        document.body.appendChild(img); // for comparisons
        div.innerHTML = 'TEST FAILED! The expected and actual images differ on average by ' + wrong + ' units/pixel. ^=expected, v=actual. Timescore: ' + totalRenderTime.toFixed(3) + ' msecs. (lower is better)<pre id="testResults"></pre>';
        div.style.color = 'red';
        document.body.appendChild(div);
        document.body.appendChild(actualImage); // to grab it for creating the test reference
      }

    } catch(e) {
      console.error(e);
    }

    var testResults = {
      numRenderedFrames: numFramesToRender,
      totalTime: totalTime,
      totalRenderTime: totalRenderTime,
      wrongPixels: wrong,
      result: testResult,
      webGLCpuTime: typeof emscriptenCpuProfiler !== 'undefined' && emscriptenCpuProfiler.sections && emscriptenCpuProfiler.sections[0] && emscriptenCpuProfiler.sections[1] ? (emscriptenCpuProfiler.sections[0].overallTimeInSection + emscriptenCpuProfiler.sections[1].overallTimeInSection) : 0,
      webGLApiCallCount: typeof emscriptenCpuProfiler !== 'undefined' && emscriptenCpuProfiler.sections && emscriptenCpuProfiler.sections[0] && emscriptenCpuProfiler.sections[1] ? (emscriptenCpuProfiler.sections[0].visitedCount + emscriptenCpuProfiler.sections[1].visitedCount) : 0,
      cpuTime: accumulatedCpuTime,
      cpuIdle: cpuIdle,
      fps: fps,
      pageLoadTime: pageLoadTime,
      numStutterEvents: numStutterEvents,
      usedJsMemory: typeof performance !== 'undefined' && performance.memory ? performance.memory.usedJSHeapSize : 0
    };
    for(var b in customTestBlocks) {
      testResults[b] = customTestBlocks[b];
    }
    console.log('reftest finished, diff: ' + wrong);
    var instructions = '\nLegend:\n'
                     + '   totalTime: How long the whole test took, from page load to finish. This includes XHR download times, so net speed affects this (msecs).\n'
                     + '   totalRenderTime: How long time it took from the *end* of the first rendered frame to the end of the last rendered frame (msecs).\n'
                     + '   wrongPixels: The number of pixels that failed the per-pixel reference image test.\n'
                     + '   result: Overall result, either PASS, FAIL (finished but reftest failed) or ERROR (run aborted on exception).\n'
                     + '   webGLCpuTime: The total CPU time spent inside browser\'s WebGL API functions (msecs).\n'
                     + '   cpuTime: The total CPU time spent inside page code in requestAnimationFrame()s (msecs).\n'
                     + '   cpuIdle: The fraction of animation time that the CPU was not executing user requestAnimationFrame() code (%). This assumes that all time outside rAF() is practically "idle" time.\n'
                     + '   fps: Total frame rate averaged throughout the whole run (frame/second).\n'
                     + '   pageLoadTime: How long it took from page load to get to the beginning of rendering the first frame (incl. downloads, compilation, parsing and app main()) (msecs). \n'
                     + '   numStutterEvents: The number of rendered frames that took abnormally long to complete compared to their previous frames. \n'
                     + '   openIndexedDB: How long it took to open an indexedDB database connection (msecs). \n'
                     + '   indexedDB.get(): How long all page IndexedDB read operations took accumulated (msecs). \n'
                     + '   indexedDB.put(): How long all page IndexedDB store operations took accumulated (msecs). \n'
                     + '   XMLHttpRequests: How long all page XHR download operations took accumulated (msecs). \n'
                     + '   WebAssembly.compile(): How long WebAssembly Module compilation took (msecs). \n'
                     + '   WebAssembly.instantiate(): How long WebAssembly Module instantiation took (msecs). \n'
                     + '   usedJsMemory: Number of JavaScript heap bytes in use. (0 if browser does not report this). \n'
                     + '   shaderCompilation: How long it took to compile all page shaders (msecs). \n'
                     + '   readDataBlob: The time it took to read the main asset .data file blob from disk to memory. \n'
                     + '   main(): The time taken in executing the initial application main() function (msecs). \n'
                     + '   excessFrametime: How much of overall time was spent above the "sweet spot" 16.667msecs/frame time limit (msecs). \n'
                     + '   pageLoadTimeToFrame1: The total time from the beginning of page load until the first application frame rendering is complete (msecs). \n'
                     + '   pageLoadTimeToFrame10: The total time from the beginning of page load until the 10th application frame has completed rendering (msecs). \n'
                     + '   timeUntilSmoothFramerate: How long it took to reach a stable animation frame rate (msecs). A stable animation frame rate is reached when ' + numFastFramesNeededForSmoothFrameRate + ' subsequent frames are rendered without a single stutter event. \n';

    if (document.getElementById('testResults')) document.getElementById('testResults').innerHTML = 'var results = ' + JSON.stringify(testResults, null, '\t') + ';\n' + instructions;

    if (top) top.postMessage({ msg: 'stopGame', key: emtimerOptions.key, results: testResults }, '*');

    if (window.opener && injectingInputStream) {
      // Post out test results.
      window.opener.postMessage(testResults, "*");
      window.onbeforeunload = null; // Don't call any application onbeforeunload handlers as a response to window.close() below.
      console.log('Done, closing test window.');
      window.close();
    } else {
      console.log('no window.opener, or not running in playback mode - not closing test window after ref finished (close it manually)');
      enablePageScrolling();
    }
  }

  try {
    actualImage.src = canvas.toDataURL();
    actualImage.onload = reftest;
  } catch(e) {
    reftest(); // canvas.toDataURL() likely failed, return results immediately.
  }

  // Emscripten-specific: stop rendering the page further.
  if (typeof Browser !== 'undefined' && Browser.mainLoop) {
    Browser.mainLoop.pause();
    Browser.mainLoop.func = Browser.mainLoop.runner = null;
  }
}

function findCanvas() {
  return emtimerOptions['canvas'] || (typeof Module !== 'undefined' && Module['canvas']) || document.querySelector('canvas');
}

// eventType: "mousemove", "mousedown" or "mouseup".
// x and y: Normalized coordinate in the range [0,1] where to inject the event.
// mX and mY: mouse movement of X and Y coordinates
// button: which button was clicked. 0 = mouse left button. If eventType="mousemove", pass 0.
function simulateMouseEvent(eventType, x, y, mX, mY, button) {
  var canvas = findCanvas();
  // Remap from [0,1] to canvas CSS pixel size.
  x *= canvas.clientWidth;
  y *= canvas.clientHeight;
  var rect = canvas.getBoundingClientRect();
  // Offset the injected coordinate from top-left of the client area to the top-left of the canvas.
  x = Math.round(rect.left + x);
  y = Math.round(rect.top + y);

  var e = new MouseEvent(eventType,{
    view: window,
    bubbles: true,
    cancelable: true,
    screenX: x,
    screenY: y,
    clientX: x,
    clientY: y,
    movementX: mX,
    movementY: mY
  });

  e.programmatic = true;

  // Dispatch to Emscripten's html5.h API:
  if (emtimerOptions['usesEmscriptenHTML5InputAPI'] && typeof JSEvents !== 'undefined' && JSEvents.eventHandlers && JSEvents.eventHandlers.length > 0) {
    for(var i = 0; i < JSEvents.eventHandlers.length; ++i) {
      if ((JSEvents.eventHandlers[i].target == canvas || JSEvents.eventHandlers[i].target == window)
       && JSEvents.eventHandlers[i].eventTypeString == eventType) {
         JSEvents.eventHandlers[i].handlerFunc(e);
      }
    }
  } else if (!emtimerOptions['dispatchMouseEventsViaDOM']) {
    // Programmatically reating DOM events doesn't allow specifying offsetX & offsetY properly
    // for the element, but they must be the same as clientX & clientY. Therefore we can't have a
    // border that would make these different.
    if (canvas.clientWidth != canvas.offsetWidth
      || canvas.clientHeight != canvas.offsetHeight) {
      throw "ERROR! Canvas object must have 0px border for direct mouse dispatch to work!";
    }
    for(var i = 0; i < registeredEventListeners.length; ++i) {
      var this_ = registeredEventListeners[i][0];
      var type = registeredEventListeners[i][1];
      var listener = registeredEventListeners[i][2];
      if (type == eventType) {
        if (emtimerOptions['needsCompleteCustomMouseEventFields']) {
          // If needsCompleteCustomMouseEventFields is set, the page needs a full set of attributes
          // specified in the MouseEvent object. However most fields on MouseEvent are read-only, so create
          // a new custom object (without prototype chain) to hold the overridden properties.
          var evt = {
            currentTarget: this_,
            srcElement: this_,
            target: this_,
            fromElement: this_,
            toElement: this_,
            eventPhase: 2, // Event.AT_TARGET
            buttons: (eventType == 'mousedown') ? 1 : 0,
            button: e.button,
            altKey: e.altKey,
            bubbles: e.bubbles,
            cancelBubble: e.cancelBubble,
            cancelable: e.cancelable,
            clientX: e.clientX,
            clientY: e.clientY,
            ctrlKey: e.ctrlKey,
            defaultPrevented: e.defaultPrevented,
            detail: e.detail,
            identifier: e.identifier,
            isTrusted: e.isTrusted,
            layerX: e.layerX,
            layerY: e.layerY,
            metaKey: e.metaKey,
            movementX: e.movementX,
            movementY: e.movementY,
            offsetX: e.offsetX,
            offsetY: e.offsetY,
            pageX: e.pageX,
            pageY: e.pageY,
            path: e.path,
            relatedTarget: e.relatedTarget,
            returnValue: e.returnValue,
            screenX: e.screenX,
            screenY: e.screenY,
            shiftKey: e.shiftKey,
            sourceCapabilities: e.sourceCapabilities,
            timeStamp: performance.now(),
            target: canvas,
            type: e.type,
            view: e.view,
            which: e.which,
            x: e.x,
            y: e.y
          };
          listener.call(this_, evt);
        } else {
          // The regular 'e' object is enough (it doesn't populate all of the same fields than a real mouse event does, 
          // so this might not work on some demos)
          listener.call(this_, e);
        }
      }
    }
  } else {
    // Dispatch directly to browser
    canvas.dispatchEvent(e);
  }
}

function simulateWheelEvent(eventType, deltaX, deltaY, deltaZ, deltaMode) {
  var canvas = findCanvas();
  var e = new Event('wheel');
  e.deltaX = deltaX;
  e.deltaY = deltaY;
  e.deltaZ = deltaZ;
  e.deltaMode = deltaMode;
  canvas.dispatchEvent(e);
}

function simulateKeyEvent(eventType, keyCode, charCode) {
  var ev = {
    keyCode: keyCode,
    which: keyCode,
    charCode: charCode,
  };
  simulateKeyEventJSON(eventType, ev);
}

function simulateKeyEventJSON(eventType, keyEvent) {
  var canvas = findCanvas();
  // Don't use the KeyboardEvent object because of http://stackoverflow.com/questions/8942678/keyboardevent-in-chrome-keycode-is-0/12522752#12522752
  // See also http://output.jsbin.com/awenaq/3
  //    var e = document.createEvent('KeyboardEvent');
  //    if (e.initKeyEvent) {
  //      e.initKeyEvent(eventType, true, true, window, false, false, false, false, keyCode, charCode);
  //  } else {

  var e = document.createEventObject ? document.createEventObject() : document.createEvent("Events");
    if (e.initEvent) {
      e.initEvent(eventType, true, true);
    }

  for(var ev in keyEvent) {
    e[ev] = keyEvent[ev];
  }
  e.programmatic = true;
  //  }

  // Dispatch directly to Emscripten's html5.h API:
  if (emtimerOptions['usesEmscriptenHTML5InputAPI'] && typeof JSEvents !== 'undefined' && JSEvents.eventHandlers && JSEvents.eventHandlers.length > 0) {
    for(var i = 0; i < JSEvents.eventHandlers.length; ++i) {
      if ((JSEvents.eventHandlers[i].target == canvas || JSEvents.eventHandlers[i].target == window)
       && JSEvents.eventHandlers[i].eventTypeString == eventType) {
         JSEvents.eventHandlers[i].handlerFunc(e);
      }
    }
  } else if (!emtimerOptions['dispatchKeyEventsViaDOM']) {
    for(var i = 0; i < registeredEventListeners.length; ++i) {
      var this_ = registeredEventListeners[i][0];
      var type = registeredEventListeners[i][1];
      var listener = registeredEventListeners[i][2];
      if (type == eventType) {
        listener.call(this_, e);
      }
    }
  } else {
    var dispatchTarget = emtimerOptions['keyEventDispatchTarget'] || canvas;
    // Dispatch to browser for real
    dispatchTarget.dispatchEvent ? dispatchTarget.dispatchEvent(e) : dispatchTarget.fireEvent("on" + eventType, e);
  }
}

if (injectingInputStream) {
  // Filter the page event handlers to only pass programmatically generated events to the site - all real user input needs to be discarded since we are
  // doing a programmatic run.
  var overriddenMessageTypes = ['mousedown', 'mouseup', 'mousemove',
    'click', 'dblclick', 'keydown', 'keypress', 'keyup',
    'pointerlockchange', 'pointerlockerror', 'webkitpointerlockchange', 'webkitpointerlockerror', 'mozpointerlockchange', 'mozpointerlockerror', 'mspointerlockchange', 'mspointerlockerror', 'opointerlockchange', 'opointerlockerror',
    'devicemotion', 'deviceorientation',
    'mousewheel', 'wheel', 'WheelEvent', 'DOMMouseScroll', 'contextmenu',
    'blur', 'focus', 'visibilitychange', 'beforeunload', 'unload', 'error',
    'pagehide', 'pageshow', 'orientationchange', 'gamepadconnected', 'gamepaddisconnected',
    'fullscreenchange', 'fullscreenerror', 'mozfullscreenchange', 'mozfullscreenerror',
    'MSFullscreenChange', 'MSFullscreenError', 'webkitfullscreenchange', 'webkitfullscreenerror',
    'touchstart', 'touchmove', 'touchend', 'touchcancel',
    'webglcontextlost', 'webglcontextrestored',
    'mouseover', 'mouseout', 'pointerout', 'pointerdown', 'pointermove', 'pointerup', 'transitionend'];

  // Some game demos programmatically fire the resize event. For Firefox and Chrome, we detect this via event.isTrusted and know to correctly pass it through, but to make Safari happy,
  // it's just easier to let resize come through for those demos that need it.
  if (!emtimerOptions['pageNeedsResizeEvent']) overriddenMessageTypes.push('resize');

  // If this_ is specified, addEventListener is called using that as the 'this' object. Otherwise the current this is used.
  function replaceEventListener(obj, this_) {
    var realAddEventListener = obj.addEventListener;
    obj.addEventListener = function(type, listener, useCapture) {
      ensureNoClientHandlers();
      if (overriddenMessageTypes.indexOf(type) != -1) {
        var registerListenerToDOM =
             (type.indexOf('mouse') == -1 || emtimerOptions['dispatchMouseEventsViaDOM'])
          && (type.indexOf('key') == -1 || emtimerOptions['dispatchKeyEventsViaDOM']);
        var filteredEventListener = function(e) { try { if (e.programmatic || !e.isTrusted) { listener(e);} } catch(e) {} };
        if (registerListenerToDOM) realAddEventListener.call(this_ || this, type, filteredEventListener, useCapture);
        registeredEventListeners.push([this_ || this, type, filteredEventListener, useCapture]);
      } else {
        realAddEventListener.call(this_ || this, type, listener, useCapture);
        registeredEventListeners.push([this_ || this, type, listener, useCapture]);
      }
    }
  }
  if (typeof EventTarget !== 'undefined') {
    replaceEventListener(EventTarget.prototype, null);
  } else {
    var eventListenerObjectsToReplace = [window, document, document.body, findCanvas()];
    if (emtimerOptions['extraDomElementsWithEventListeners']) eventListenerObjectsToReplace = eventListenerObjectsToReplace.concat(emtimerOptions['extraDomElementsWithEventListeners']);
    for(var i = 0; i < eventListenerObjectsToReplace.length; ++i) {
      replaceEventListener(eventListenerObjectsToReplace[i], eventListenerObjectsToReplace[i]);
    }
  }
}

// Wallclock time for when we started CPU execution of the current frame.
var referenceTestT0 = -1;

function referenceTestPreTick() {
  ++referenceTestPreTickCalledCount;
  if (referenceTestPreTickCalledCount == 1) {
    referenceTestT0 = performance.realNow();
    if (pageLoadTime === null) pageLoadTime = performance.realNow() - pageStartupT0;

    // We will assume that after the reftest tick, the application is running idle to wait for next event.
    if (previousEventHandlerExitedTime != -1) {
      accumulatedCpuIdleTime += performance.realNow() - previousEventHandlerExitedTime;
      previousEventHandlerExitedTime = -1;
    }
  }
}

// Captures the whole input stream as a JavaScript formatted code.
var recordedInputStream = 'function injectInputStream(referenceTestFrameNumber) { <br>';

function enablePageScrolling() {
  // It is common to set 'overflow: hidden;' on canvas pages that do WebGL. When CpuProfiler is being used, there will be a long block of text on the page, so force-enable scrolling.
  document.body.style.overflow = '';
  var style = document.createElement('style');
  style.type = 'text/css';
  style.appendChild(document.createTextNode("body {overflow: visible !important;}"));
  document.head.appendChild(style);
}

function dumpRecordedInputStream() {  
  recordedInputStream += '}<br>';

  var div = document.createElement('div');
  div.innerHTML = '<pre>'+recordedInputStream+'</pre>';
  document.body.appendChild(div);
  var canvas = findCanvas();
  if (canvas) canvas.style = 'display: none';

  enablePageScrolling();
}

function rampFloat(x0, y0, x1, y1, val) {
  return (val <= x0) ? y0 : (val >= x1 ? y1 : ((val-x0)/(x1-x0)*(y1-y0) + y0));
}

function applyGain(inst, desiredAudioVolume) {
  if (inst && inst.gain && inst.gain.gain) {
    if (inst.gain.gain.originalValue === undefined) inst.gain.gain.originalValue = inst.gain.gain.value;
    inst.gain.gain.value = desiredAudioVolume * inst.gain.gain.originalValue;
  }
}

// Perform a nice fade-in and fade-out of audio volume.
function manageOpenALAudioMasterVolumeForTimedemo() {
  var fadeTime = emtimerOptions['audioFadeoutTimeAtEnd'] || 90;
  var silenceTime = emtimerOptions['audioSilenceTimeAtEnd'] || 90;
  // Only fade out for now.
  if (referenceTestFrameNumber < numFramesToRender-fadeTime-silenceTime) return;

  var desiredAudioVolume = Math.min(rampFloat(0, 0.0, fadeTime, 1.0, referenceTestFrameNumber), rampFloat(numFramesToRender-fadeTime-silenceTime, 1.0, numFramesToRender-silenceTime, 0.0, referenceTestFrameNumber));

  var pageBGAudio = document.getElementById('AudioElement');
  if (pageBGAudio) pageBGAudio.volume = desiredAudioVolume;

  if (typeof AL !== 'undefined') {
    if (AL.currentContext && AL.currentContext.gain) {
      if (AL.currentContext.gain.gain) AL.currentContext.gain.gain.value = desiredAudioVolume; // New Emscripten OpenAL
      else AL.currentContext.gain.value = desiredAudioVolume; // Old Emscripten OpenAL
    } else {
      if (AL.currentContext.src) { // New Emscripten OpenAL
        for(var i = 0; i < AL.currentContext.src.length; ++i) {
          var src = AL.currentContext.src[i];
          applyGain(src, desiredAudioVolume);
        }
      }
      if (AL.src) { // Old Emscripten OpenAL
        for(var i = 0; i < AL.src.length; ++i) {
          var src = AL.src[i];
          applyGain(src, desiredAudioVolume);
        }
      }
    }
  }
  if (typeof WEBAudio !== 'undefined' && WEBAudio.audioInstances) {
    for (var i in WEBAudio.audioInstances) {
      var inst = WEBAudio.audioInstances[i];
      applyGain(inst, desiredAudioVolume);
    }
    // Finally, kill audio altogether.
    // N.b. check for the existence of WEBAudio.audioContext.suspend, since e.g. Edge 13 doesn't have it:
    // https://wpdev.uservoice.com/forums/257854-microsoft-edge-developer/suggestions/12855546-web-audio-api-audiocontext-needs-suspend-and-resum
    if (WEBAudio.audioContext && WEBAudio.audioContext.suspend && referenceTestFrameNumber >= numFramesToRender) {
      WEBAudio.audioContext.suspend();
    }
  }
}

// Holds the amount of time in msecs that the previously rendered frame took. Used to estimate when a stutter event occurs (fast frame followed by a slow frame)
var lastFrameDuration = -1;

// Wallclock time for when the previous frame finished.
var lastFrameTick = -1;

var timeOfFrame1 = -1;

// If -1, we are not running an event. Otherwise represents the wallclock time of when we exited the last event handler.
var previousEventHandlerExitedTime = -1;

var accumulatedCpuIdleTime = 0;

function referenceTestTick() {
  --referenceTestPreTickCalledCount;

  if (referenceTestPreTickCalledCount > 0)
    return; // We are being called recursively, so ignore this call.

  if (!emtimerRuntimeInitialized) return;

  ensureNoClientHandlers();

  var t1 = performance.realNow();
  if (referenceTestT0 != -1) {
    accumulatedCpuTime += t1 - referenceTestT0;
    var smoothFramerateMsecs = 1000.0 / 60.0; // NOTE: If running on a 120 Hz display or something like that, the results are wrong on this field.
    emunittestReportCustomBlockDuration('excessFrametime', '+' + Math.max(0, t1 - referenceTestT0 - smoothFramerateMsecs));
    referenceTestT0 = -1;
  }


  var frameDuration = t1 - lastFrameTick;
  lastFrameTick = t1;
  if (referenceTestFrameNumber > 5 && lastFrameDuration > 0) {
    if (frameDuration > 20.0 && frameDuration > lastFrameDuration * 1.35) {
      ++numStutterEvents;
      if (numConsecutiveSmoothFrames != -1) numConsecutiveSmoothFrames = 0;
    } else {
      if (numConsecutiveSmoothFrames != -1) {
        ++numConsecutiveSmoothFrames;
        if (numConsecutiveSmoothFrames >= numFastFramesNeededForSmoothFrameRate) {
          emunittestReportCustomBlockDuration('timeUntilSmoothFramerate', t1 - timeOfFrame1);
          numConsecutiveSmoothFrames = -1;
        }
      }
    }
  }
  lastFrameDuration = frameDuration;

  if (numPreloadXHRsInFlight == 0) { // Important! The frame number advances only for those frames that the game is not waiting for data from the initial network downloads.
    if (numStartupBlockerXHRsPending == 0) ++referenceTestFrameNumber; // Actual reftest frame count only increments after game has consumed all the critical XHRs that were to be preloaded.
    ++fakedTime; // But game time advances immediately after the preloadable XHRs are finished.
  }

  if (referenceTestFrameNumber == 1) {
    timeOfFrame1 = t1;
    emunittestReportCustomBlockDuration('pageLoadTimeToFrame1', t1 - pageStartupT0);
  } else if (referenceTestFrameNumber == 10) {
    emunittestReportCustomBlockDuration('pageLoadTimeToFrame10', t1 - pageStartupT0);
  }

  if (referenceTestFrameNumber == 3 && location.search.indexOf('fakegl') != -1) {
    noOpWebGL();
  }

  if (referenceTestFrameNumber == 1) {
    emtimerOptions['timeStart'] = t1;
    if (injectingInputStream && emtimerOptions['refTest']) loadReferenceImage();

    top.postMessage({ msg: 'startGame', key: emtimerOptions.key }, '*');
  }
  if (injectingInputStream) {
    if (typeof injectInputStream !== 'undefined') {
      injectInputStream(referenceTestFrameNumber);
    }
    manageOpenALAudioMasterVolumeForTimedemo();
  }
  if (referenceTestFrameNumber == numFramesToRender) {
    if (recordingInputStream) {
      dumpRecordedInputStream();
    } else if (injectingInputStream) {
      unloadAllEventHandlers();
      doReferenceTest();
    }
  }
  // We will assume that after the reftest tick, the application is running idle to wait for next event.
  previousEventHandlerExitedTime = performance.realNow();
}

// This function is called when the initial loading (main()) has completed, and the game is about to start
// ticking its requestAnimationFrame() loop
function onRuntimeInitialized() {
  if (emtimerRuntimeInitialized) return;
  fakedTime = 0;
  referenceTestFrameNumber = 0;
  emtimerRuntimeInitialized = 1;
  if (typeof cpuprofiler_add_hooks !== 'undefined' && enableCpuProfiler) cpuprofiler_add_hooks();
}

emtimerOptions['onRuntimeInitialized'] = onRuntimeInitialized;

// Maps mouse coordinate from canvas CSS pixels to normalized [0,1] range. In y coordinate y grows downwards.
function computeNormalizedCanvasPos(e) {
  var canvas = findCanvas();
  var rect = canvas.getBoundingClientRect();
  var x = e.clientX - rect.left;
  var y = e.clientY - rect.top;
  var clientWidth = canvas.clientWidth;
  var clientHeight = canvas.clientHeight;
  x /= clientWidth;
  y /= clientHeight;
  return [x, y];
}

function captureInputHandlers() {
  var c = findCanvas();
  if (!c) {
    return (typeof realSetTimeout !== 'undefined'?realSetTimeout:setTimeout)(captureInputHandlers, 0);
  }
  c.addEventListener("mousedown", function(e) {
    var pos = computeNormalizedCanvasPos(e);
    recordedInputStream += 'if (referenceTestFrameNumber == ' + referenceTestFrameNumber + ') simulateMouseEvent("mousedown", '+ pos[0] + ', ' + pos[1] + ', 0);<br>';
    });

  c.addEventListener("mouseup", function(e) {
    var pos = computeNormalizedCanvasPos(e);
    recordedInputStream += 'if (referenceTestFrameNumber == ' + referenceTestFrameNumber + ') simulateMouseEvent("mouseup", '+ pos[0] + ', ' + pos[1] + ', 0);<br>';
    });

  c.addEventListener("mousemove", function(e) {
    var pos = computeNormalizedCanvasPos(e);
    recordedInputStream += 'if (referenceTestFrameNumber == ' + referenceTestFrameNumber + ') simulateMouseEvent("mousemove", '+ pos[0] + ', ' + pos[1] + ', ' + e.movementX + ', ' + e.movementY + ', 0);<br>';
    });

  c.addEventListener("wheel", function(e) {
    recordedInputStream += 'if (referenceTestFrameNumber == ' + referenceTestFrameNumber + ') simulateWheelEvent("wheel", '+ e.deltaX + ', ' + e.deltaY + ', ' + e.deltaZ + ', ' + e.deltaMode + ');<br>';
    });

  window.addEventListener("keydown", function(e) {
    var ev = {
      altKey: e.altKey,
      charCode: e.charCode,
      code: e.code,
      ctrlKey: e.ctrlKey,
      key: e.key,
      keyCode: e.keyCode,
      metaKey: e.metaKey,
      repeat: e.repeat,
      shiftKey: e.shiftKey,
      type: e.type,
      which: e.which
    }
    recordedInputStream += 'if (referenceTestFrameNumber == ' + referenceTestFrameNumber + ') simulateKeyEventJSON("keydown", ' + JSON.stringify(ev) + ');<br>';
    });

  window.addEventListener("keyup", function(e) {
    var ev = {
      altKey: e.altKey,
      charCode: e.charCode,
      code: e.code,
      ctrlKey: e.ctrlKey,
      key: e.key,
      keyCode: e.keyCode,
      metaKey: e.metaKey,
      repeat: e.repeat,
      shiftKey: e.shiftKey,
      type: e.type,
      which: e.which
    }
    recordedInputStream += 'if (referenceTestFrameNumber == ' + referenceTestFrameNumber + ') simulateKeyEventJSON("keyup", ' + JSON.stringify(ev) + ');<br>';
    });
}

// Inject mouse and keyboard capture event handlers to record input stream.
if (recordingInputStream) {
  captureInputHandlers();
}

// Hide a few Emscripten-specific page elements from the default shell to remove unwanted interactivity options.
if (injectingInputStream || recordingInputStream) {
  var elems = document.getElementsByClassName('fullscreen');
  for(var i in elems) {
    var e = elems[i];
    e.style = 'display:none';
  }
  var output = document.getElementById('output');
  if (output)
    output.style = 'display:none';
}

function noOpWebGL(glCtx) {
  if (!glCtx) {
    glCtx = (function detectWebGLContext() {
      if (typeof Module !== 'undefined' && Module['canvas'] && Module['canvas'].GLctxObject && Module['canvas'].GLctxObject.GLctx) return Module['canvas'].GLctxObject.GLctx;
      else if (typeof GLctx !== 'undefined') return GLctx;
      else if (typeof Module !== 'undefined' && Module.ctx) return Module.ctx;
      else {
        var canvas = findCanvas();
        if (canvas && canvas.GLctxObject && canvas.GLctxObject.GLctx) return canvas.GLctxObject.GLctx;
      }
      return document.querySelector('canvas').getContext('webgl');
    })();
  }
  console.log('Nopping out hot GL function calls.');

  // 1. Fake a number of GL functions to simply return 0:
  var fakeFunctionsToReturn0 = ['isContextLost', 'finish', 'flush', 'getError', 'endTransformFeedback', 'pauseTransformFeedback', 'resumeTransformFeedback',
                                'activeTexture', 'blendEquation', 'clear', 'clearDepth', 'clearStencil', 'compileShader', 'cullFace', 'deleteBuffer',
                                'deleteFramebuffer', 'deleteProgram', 'deleteRenderbuffer', 'deleteShader', 'deleteTexture', 'depthFunc', 'depthMask', 'disable', 'disableVertexAttribArray',
                                'enable', 'enableVertexAttribArray', 'frontFace', 'generateMipmap', 'lineWidth', 'linkProgram', 'stencilMask', 'useProgram', 'deleteQuery', 'deleteVertexArray',
                                'bindVertexArray', 'drawBuffers', 'readBuffer', 'endQuery', 'deleteSampler', 'deleteSync', 'deleteTransformFeedback', 'beginTransformFeedback',
                                'attachShader', 'bindBuffer', 'bindFramebuffer', 'bindRenderbuffer', 'bindTexture', 'blendEquationSeparate', 'blendFunc', 'depthRange', 'detachShader', 'hint',
                                'pixelStorei', 'polygonOffset', 'sampleCoverage', 'shaderSource', 'stencilMaskSeparate', 'uniform1f', 'uniform1fv', 'uniform1i', 'uniform1iv',
                                'uniform2fv', 'uniform2iv', 'uniform3fv', 'uniform3iv', 'uniform4fv', 'uniform4iv', 'vertexAttrib1f', 'vertexAttrib1fv', 'vertexAttrib2fv', 'vertexAttrib3fv',
                                'vertexAttrib4fv', 'vertexAttribDivisor', 'beginQuery', 'invalidateFramebuffer', 'uniform1ui', 'uniform1uiv', 'uniform2uiv', 'uniform3uiv', 'uniform4uiv',
                                'vertexAttribI4iv', 'vertexAttribI4uiv', 'bindSampler', 'fenceSync', 'bindTransformFeedback',
                                'bindAttribLocation', 'bufferData', 'bufferSubData', 'drawArrays', 'stencilFunc', 'stencilOp', 'texParameterf', 'texParameteri', 'uniform2f', 'uniform2i',
                                'uniformMatrix2fv', 'uniformMatrix3fv', 'uniformMatrix4fv', 'vertexAttrib2f', 'uniform2ui', 'uniformMatrix2x3fv', 'uniformMatrix3x2fv',
                                'uniformMatrix2x4fv', 'uniformMatrix4x2fv', 'uniformMatrix3x4fv', 'uniformMatrix4x3fv', 'clearBufferiv', 'clearBufferuiv', 'clearBufferfv', 'samplerParameteri',
                                'samplerParameterf', 'clientWaitSync', 'waitSync', 'transformFeedbackVaryings', 'bindBufferBase', 'uniformBlockBinding',
                                'blendColor', 'blendFuncSeparate', 'clearColor', 'colorMask', 'drawElements', 'framebufferRenderbuffer', 'renderbufferStorage', 'scissor', 'stencilFuncSeparate',
                                'stencilOpSeparate', 'uniform3f', 'uniform3i', 'vertexAttrib3f', 'viewport', 'drawArraysInstanced', 'uniform3ui', 'clearBufferfi',
                                'framebufferTexture2D', 'uniform4f', 'uniform4i', 'vertexAttrib4f', 'drawElementsInstanced', 'copyBufferSubData', 'framebufferTextureLayer',
                                'renderbufferStorageMultisample', 'texStorage2D', 'uniform4ui', 'vertexAttribI4i', 'vertexAttribI4ui', 'vertexAttribIPointer', 'bindBufferRange',
                                'texImage2D', 'vertexAttribPointer', 'invalidateSubFramebuffer', 'texStorage3D', 'drawRangeElements',
                                'compressedTexImage2D', 'readPixels', 'texSubImage2D', 'compressedTexSubImage2D', 'copyTexImage2D', 'copyTexSubImage2D', 'compressedTexImage3D',
                                'copyTexSubImage3D', 'blitFramebuffer', 'texImage3D', 'compressedTexSubImage3D', 'texSubImage3D'];
  function nop0() { return 0; }
  for(var f in fakeFunctionsToReturn0) {
    glCtx[fakeFunctionsToReturn0[f]] = nop0;
  }

  // 2. Fake certain GL functions to return 1:
  var fakeFunctionsToReturn1 = ['isBuffer', 'isEnabled', 'isFramebuffer', 'isProgram', 'isQuery', 'isVertexArray', 'isSampler', 'isSync', 'isTransformFeedback',
                                'isRenderbuffer', 'isShader', 'isTexture', 'validateProgram'];
  function nop1() { return 1; }
  for(var f in fakeFunctionsToReturn1) {
    glCtx[fakeFunctionsToReturn1[f]] = nop1;
  }

  // 3. checkFramebufferStatus() must return a special enum to fake ok result.
  glCtx['checkFramebufferStatus'] = function() { return 0x8CD5; }; // GL_FRAMEBUFFER_COMPLETE

// After the above, the following functions remain in GL, let them run like original:
//'createBuffer', 'createFramebuffer', 'createProgram', 'createRenderbuffer', 'createTexture',
//'createVertexArray', 'createQuery', 'createSampler', 'createTransformFeedback', 'getExtension', 'createShader', 'getAttachedShaders', 'getParameter', 'getProgramInfoLog', 'getShaderInfoLog', 'getShaderSource'

//'getContextAttributes', 'getSupportedExtensions', 
//'getActiveAttrib', 'getActiveUniform', 'getAttribLocation', 'getBufferParameter', 'getProgramParameter', 'getRenderbufferParameter', 'getShaderParameter', 'getShaderPrecisionFormat', 'getTexParameter', 'getUniform', 'getUniformLocation',
//'getVertexAttrib', 'getVertexAttribOffset', 'getFragDataLocation', 'getQuery', 'getQueryParameter', 'getSamplerParameter', 'getSyncParameter', 'getTransformFeedbackVarying', 'getIndexedParameter', 'getUniformIndices',
//'getUniformBlockIndex', 'getActiveUniformBlockName', 'getFramebufferAttachmentParameter', 'getBufferSubData', 'getInternalformatParameter', 'getActiveUniforms', 'getActiveUniformBlockParameter'
}

// Page load starts now.
var pageStartupT0 = performance.realNow();
