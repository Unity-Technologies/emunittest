let {
  emrun_exit,
  emrun_print,
  emrun_printErr,
} = window;

const autoRunEnabled = location.search.toLowerCase().indexOf('autorun') != -1;

(function createEventListeners() {
  document.getElementById('show-system-information').addEventListener('click', () => {
    toggleVisible('show-system-information', 'system_information');
  });
  document.getElementById('system_information').addEventListener('click', () => {
    selectText('system_information');
  });
  document.getElementById('toggleAllOrNoneTests').addEventListener('click', toggleAllOrNoneTests);
  document.getElementById('parallelTortureMode').addEventListener('click', updateNumParallelWindowsEnabled);
  document.getElementById('parallelTortureModeLabel').addEventListener('click', updateNumParallelWindowsEnabled);
  document.getElementById('runTests').addEventListener('click', runSelectedTests);
  const selectFullTestResults = () => {
    selectText('full_test_results');
  };
  document.getElementById('full_test_results').addEventListener('click', selectFullTestResults);
  document.getElementById('select_full_test_results').addEventListener('click', selectFullTestResults);
}());

if (location.search.toLowerCase().indexOf('numtimes=') != -1) {
  var numTimesToRunEachTest = parseInt(location.search.substring(location.search.toLowerCase().indexOf('numtimes=') + 'numtimes='.length));
  document.getElementById('numTimesToRunEachTest').value = numTimesToRunEachTest;
}

document.getElementById('noVsync').checked = (location.search.toLowerCase().indexOf('novsync') != -1);
document.getElementById('fakeGL').checked = (location.search.toLowerCase().indexOf('fakeGL') != -1);
if (location.search.toLowerCase().indexOf('nocpuprofiler') != -1 || autoRunEnabled) {
  document.getElementById('cpuProfiler').checked = false;
}
document.getElementById('tortureMode').checked = (location.search.toLowerCase().indexOf('torturemode') != -1);
document.getElementById('parallelTortureMode').checked = (location.search.toLowerCase().indexOf('paralleltorturemode') != -1);

var browserInfo = null;

// Aggregates all test results by test name, e.g. allTestResultsByKey['angrybots'] is an array containing results of each run of that demo.
var allTestResultsByKey = {};

const {host, protocol} = window.location;
var testData = await fetch(`${protocol}//${host}/demo_list.json`);
var tests = await testData.json();

// If running on a mobile browser, filter out showing the tests that can't be run on a mobile browser.
var isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
if (isMobile) tests = tests.filter(function(t) { return t.mobile; });

function getTestByKey(key) {
  for(var i = 0; i < tests.length; ++i) if (tests[i].key == key) return tests[i];
}

var testsQueuedToRun = [];

function getValueOfParam(key) {
  var results = (new RegExp("[\\?&]"+key+"=([^&#]*)")).exec(location.href);
  return results ? results[1] : '';
}
var selectedTestsAtStart = getValueOfParam('selectedTests').replace('%20', '');
if (selectedTestsAtStart) {
  selectedTestsAtStart = selectedTestsAtStart.split(',');
  for(var i = 0; i < selectedTestsAtStart.length; ++i) selectedTestsAtStart[i] = selectedTestsAtStart[i].trim().toLowerCase();
}

(function createTable() {
  var demos = '<table><tr><td><b>Name</b></td><td><b>Version</b></td><td><b>Result</b></td><td style="max-width:50px;"><b>Scope</b></td><td><b>Engine</b></td><td><b>Disk Size</b></td><td><b>Heap Size</b></td><td><b>Test</b></td><td><b>Interactive</b></td></tr>'
  for(var i = 0; i < tests.length; ++i) {
    var t = tests[i];
    t.id = i;

    var item = '<tr style="background-color: ' + ((i % 2 == 1) ? '#F0F0F0' : '#D0D0D0') + ' ;">';
    var checked = (selectedTestsAtStart.length == 0 || selectedTestsAtStart.indexOf(t.name.toLowerCase()) != -1 || selectedTestsAtStart.indexOf(t.key.toLowerCase()) != -1) ? 'checked' : '';
    item += `<td><input type="checkbox" class="game-select" name="${t.name}" id="${t.name}" ${checked} /><label for="${t.name}">${t.name}</label></td>`;
    item += '<td>' + t.date + '</td>';
    item += '<td id="results_' + t.id + '">Not yet run</td>';
    item += '<td style="font-size:8px; max-width:150px;">' + t.apis.join(', ') + '</td>';
    item += '<td style="font-size:8px;">';
    if (t.engine) item += t.engine;
    if (t.engine && t.compiler) item += ', ';
    if (t.compiler) item += t.compiler;
    item += '</td>';
    item += '<td>' + Math.round(t.size/1024/1024) + ' MB' + '</td>';
    item += '<td>' + (t.heap ? Math.round(t.heap/1024/1024) + ' MB' : 'N/A') + '</td>';
    item += '<td style="text-align:center">';
    item += `<button class="test-game-button" data-index="${t.id}">Test</button>`;
    item += '</td>';
    item += '<td style="text-align:center">';
    if (t.interactive) item += `<button class="launch-game-button" data-index="${t.id}">Launch</button>`;
    item += '</td>';
    item += '</tr>'
    demos += item;
  }
  demos += '</table>';
  const parentElement = document.getElementById('tests');
  parentElement.innerHTML = demos;
  parentElement.addEventListener('click', (e) => {
    const element = e.target;
    if (element.classList.contains('test-game-button')) {
      runTest(parseInt(element.dataset.index), false);
    } else if (element.classList.contains('launch-game-button')) {
      runTest(parseInt(element.dataset.index), true);
    } else if (element.classList.contains('game-select')) {
      countAndUpdateNumTestsSelected();
    }
  });
  countAndUpdateNumTestsSelected();
})();


function getSelectedTests() {
  var selected = [];
  for(var i = 0; i < tests.length; ++i) {
    var t = tests[i];
    if (document.getElementById(t.name).checked) selected.push(t);
  }
  return selected;
}

function countAndUpdateNumTestsSelected() {
  var numTestsSelected = getSelectedTests().length;
  document.getElementById('numTestsSelected').innerHTML = (numTestsSelected == 0 ? "No" : numTestsSelected) + (numTestsSelected == 1 ? " test " : " tests ") + 'selected.';
  document.getElementById('toggleAllOrNoneTests').innerHTML = (numTestsSelected != tests.length) ? 'Select all' : 'Select none';
  document.getElementById('runTests').disabled = (numTestsSelected == 0);
  return numTestsSelected;
}

function toggleAllOrNoneTests() {
  var numTestsSelected = countAndUpdateNumTestsSelected();
  var checkedState = (numTestsSelected != tests.length);
  for(var i = 0; i < tests.length; ++i) {
    var t = tests[i];
    document.getElementById(t.name).checked = checkedState;
  }
  countAndUpdateNumTestsSelected();
}

function updateNumParallelWindowsEnabled() {
  document.getElementById('numParallelWindows').disabled = !document.getElementById('parallelTortureMode').checked;
}
var runningTestsInProgress = false;
var currentlyRunningTest = null;
var currentlyRunningNoVsync = false;
var currentlyRunningFakeGL = false;
var currentlyRunningCpuProfiler = false;
var currentlyRunningWebGLProfiler = false;
function runTest(idx, interactive) {
  var fakeGL = document.getElementById('fakeGL').checked;
  var noVsync = document.getElementById('noVsync').checked;
  var cpuProfiler = document.getElementById('cpuProfiler').checked;
  var webglProfiler = document.getElementById('webglProfiler').checked;
  var test = tests[idx];
  emrun_print('runTest "' + test.name + '"'); // Print progress indication so the harness knows we are not hung.
  currentlyRunningTest = test;
  currentlyRunningTest.startTime = new Date();
  currentlyRunningTest.runUuid = generateUUID();
  currentlyRunningNoVsync = noVsync && test.noVsync;
  currentlyRunningFakeGL = fakeGL;
  currentlyRunningCpuProfiler = cpuProfiler;
  currentlyRunningWebGLProfiler = webglProfiler;
  var url = test.url;
  function addGET(url, get) {
    if (url.indexOf('?') != -1) return url + '&' + get;
    else return url + '?' + get;
  }
  if (!interactive) url = addGET(url, 'playback');
  if (noVsync && test.noVsync) url = addGET(url, 'novsync');
  if (fakeGL) url = addGET(url, 'fakegl');
  if (cpuProfiler) url = addGET(url, 'cpuprofiler');
  if (webglProfiler) url = addGET(url, 'webglprofiler');
  if (test.length) url = addGET(url, 'numframes=' + test.length);

  var parallelTortureMode = document.getElementById('parallelTortureMode').checked;
  var numSpawnedWindows = parallelTortureMode ? document.getElementById('numParallelWindows').value : 1;
  for(var i = 0; i < numSpawnedWindows; ++i) {
    window.open(url);
  }
  var data = {
    'browserUuid': browserUuid,
    'key': test.key,
    'name': test.name,
    'startTime': new Date().yyyymmddhhmmss(),
    'result': 'unfinished',
    'noVsync': noVsync,
    'fakeGL': fakeGL,
    'cpuProfiler': cpuProfiler,
    'webglProfiler': webglProfiler,
    'runUuid': currentlyRunningTest.runUuid,
    'runOrdinal': allTestResultsByKey[test.key] ? (allTestResultsByKey[test.key].length + 1) : 1
  };
  if (browserInfo && browserInfo.nativeSystemInfo && browserInfo.nativeSystemInfo.uuid) data.hardwareUuid = browserInfo.nativeSystemInfo.uuid;
  resultsServer_StoreTestStart(data);
  // If chaining parallel and sequential torture modes, uncheck the parallel torture mode checkbox icon so that the new tests don't multiply when finished!
  if (document.getElementById('tortureMode').checked) document.getElementById('parallelTortureMode').checked = false;
  updateNumParallelWindowsEnabled();
}

function runNextQueuedTest() {
  if (testsQueuedToRun.length == 0) return false;
  var t = testsQueuedToRun[0];
  testsQueuedToRun.splice(0, 1);
  runTest(t.id, false);
  return true;
}

function runSelectedTests() {
  testsQueuedToRun = getSelectedTests();
  var numTimesToRunEachTest = parseInt(document.getElementById('numTimesToRunEachTest').value);
  if (numTimesToRunEachTest > 1) {
    if (numTimesToRunEachTest > 100000) numTimesToRunEachTest = 100000; // Arbitrary max cap

    var multiples = [];
    for(var i = 0; i < testsQueuedToRun.length; ++i) {
      for(var j = 0; j < numTimesToRunEachTest; ++j) {
        multiples.push(testsQueuedToRun[i]);
      }
    }
    testsQueuedToRun = multiples;
  }
  runningTestsInProgress = true;
  runNextQueuedTest();
}

// When C code exit()s, we may still have remaining stdout and stderr messages in flight. In that case, we can't close
// the browser until all those XHRs have finished, so the following state variables track that all communication is done,
// after which we can close.
var emrun_num_post_messages_in_flight = 0;
var emrun_should_close_itself = false;
function postExit(msg) {
  var http = new XMLHttpRequest();
  http.onreadystatechange = function() {
    if (http.readyState == 4 /*DONE*/) {
      try {
        // Try closing the current browser window, since it exit()ed itself. This can shut down the browser process
        // and emrun does not need to kill the whole browser process.
        if (typeof window !== 'undefined' && window.close) window.close();
      } catch(e) {}
    }
  }
  http.open("POST", "stdio.html", true);
  http.send(msg);
}
var EXITSTATUS = 0;
function post(msg) {
  var http = new XMLHttpRequest();
  ++emrun_num_post_messages_in_flight;
  http.onreadystatechange = function() {
    if (http.readyState == 4 /*DONE*/) {
      if (--emrun_num_post_messages_in_flight == 0 && emrun_should_close_itself) postExit('^exit^'+EXITSTATUS);
    }
  }
  http.open("POST", "stdio.html", true);
  http.send(msg);
}

// If autoRun is enabled, assume we want to automatically close the browser the test(s) finish
if (autoRunEnabled) {
  var emrun_http_sequence_number = 1;
  emrun_exit = function() { if (emrun_num_post_messages_in_flight == 0) postExit('^exit^'+EXITSTATUS); else emrun_should_close_itself = true; };
  emrun_print = function(text) { post('^out^'+(emrun_http_sequence_number++)+'^'+encodeURIComponent(text)); }
  emrun_printErr = function (text) { post('^err^'+(emrun_http_sequence_number++)+'^'+encodeURIComponent(text)); }

  // Notify emrun web server that this browser has successfully launched the page.
  post('^pageload^');
} else {
  // otherwise, don't pass any exit/print functions, and the browser stays open
  emrun_exit = function() {}
  emrun_print = function(text) {}
  emrun_printErr = function(text) {}
}

emrun_print("index.html loading");

function padLengthRight(s, len, ch) {
  if (ch === undefined) ch = ' ';
  while(s.length < len) s += ch;
  return s;
}
function padLengthLeft(s, len, ch) {
  if (ch === undefined) ch = ' ';
  while(s.length < len) s = ch + s;
  return s;
}

function prettyPrintTestLogLine(t) {
  var s = '';
  if (t.result) {
    var time = padLengthLeft(padLengthRight(new Date().yyyymmddhhmm(), 17), 18);
    var n = padLengthLeft(padLengthRight(t.name + '-' + t.date, 38), 39);
    if (!t.result.error) {
      var dur = t.result.totalTime + 'ms';
      if (t.result.noVsync) dur += ' (no vsync)';
      if (t.result.fakeGL) dur += ' (no GL)';
      if (t.result.webglProfiler) dur += ' (cpu+webglprof)';
      else if (t.result.cpuProfiler) dur += ' (cpuprof)';
      if (t.result.result == 'FAIL') dur += ' (FAILED! diff: ' + t.result.wrongPixels + ')';
      dur = padLengthRight(padLengthLeft(dur, 29), 30);
      var fps = padLengthRight(padLengthLeft(t.result.fps.toFixed(2), 6), 7);
      var cpuIdle = padLengthRight(padLengthLeft(t.result.cpuIdle.toFixed(2) + '%', 9), 10);
      if (t.result.webGLCpuTime) {
        var webGLCpuTime = Math.round(t.result.webGLCpuTime) + 'ms (' + (t.result.webGLCpuTime*100.0/t.result.cpuTime).toFixed(2) + '%)';
        var webGLApiCallCount = (t.result.webGLApiCallCount / t.result.numRenderedFrames).toFixed(2);
      } else {
        var webGLCpuTime = '(not tracked)';
        var webGLApiCallCount = '(not tracked)';
      }
      webGLCpuTime = padLengthRight(padLengthLeft(webGLCpuTime, 17), 18);
      webGLApiCallCount = padLengthRight(padLengthLeft(webGLApiCallCount, 17), 18);
      var cpuTime = padLengthRight(padLengthLeft(Math.round(t.result.cpuTime) + 'ms', 9), 10);
      var pageLoadTime = padLengthRight(padLengthLeft(t.result.pageLoadTime.toFixed(2) + 'ms', 15), 16);
      var numStutterEvents = padLengthRight(padLengthLeft(t.result.numStutterEvents+'', 19), 20);
      var usedJsMemory = padLengthLeft(t.result.usedJsMemory == 0 ? 'N/A' : (t.result.usedJsMemory/1024/1024).toFixed(1)+'MB', 12);
      return time + '|' + n + '|' + dur + '|' + fps + '|' + cpuTime + '|' + webGLCpuTime + '|' + webGLApiCallCount + '|' + cpuIdle + '|' + pageLoadTime + '|' + numStutterEvents + '|' + usedJsMemory + '\n';
    } else {
      return time + '|' + n + '|' + 'ERROR! ' + t.result.error + '\n';
    }
  }
}

function writeFullTestResults() {
  var s = '<pre>\n' + fullTestLog;
  for(var key in allTestResultsByKey) {
    if (allTestResultsByKey[key] && allTestResultsByKey[key].length > 1) {
      var results = allTestResultsByKey[key];

      function get70PercentAverage(getField) {
        function get70PercentArray() {
          function cmp(a, b) {
            return getField(a) - getField(b);
          }
          function filterEmptyElements(arr) {
            var nonempty = [];
            for(var i = 0; i < arr.length; ++i) {
              if (getField(arr[i])) {
                nonempty.push(arr[i]);
              }
            }
            return nonempty;
          }
          var elemsToInclude = filterEmptyElements(results);
          if (elemsToInclude.length <= 3) return elemsToInclude.slice(0);
          var frac = Math.round(0.7 * elemsToInclude.length);
          var resultsC = elemsToInclude.slice(0);
          resultsC.sort(cmp);
          var numElementsToRemove = elemsToInclude.length - frac;
          var numElementsToRemoveFront = Math.floor(numElementsToRemove/2);
          var numElementsToRemoveBack = numElementsToRemove - numElementsToRemoveFront;
          return resultsC.slice(numElementsToRemoveFront, resultsC.length - numElementsToRemoveBack);
        }
        var arr = get70PercentArray();
        var total = 0;
        for(var i = 0; i < arr.length; ++i) total += getField(arr[i]);
        return total / arr.length;
      }

      var numSamples = '(' + (results.length <= 3 ? results.length : Math.round(0.7 * results.length)) + ' samples)';
      var time = padLengthLeft(padLengthRight(numSamples, 17), 18);
      var test = getTestByKey(key);
      var n = padLengthLeft(padLengthRight(test.name + '-' + test.date + ' (Averaged)', 38), 39);
      var totalTime = get70PercentAverage(function(p) { return p.totalTime; });
      var fps = get70PercentAverage(function(p) { return p.fps; });
      var cpuIdle = get70PercentAverage(function(p) { return p.cpuIdle; });
      var cpuTime = get70PercentAverage(function(p) { return p.cpuTime; });
      var webGLCpuTime = get70PercentAverage(function(p) { return p.webGLCpuTime; });
      var webGLApiCallCount = get70PercentAverage(function(p) { return p.webGLApiCallCount; });
      var numRenderedFrames = get70PercentAverage(function(p) { return p.numRenderedFrames; });
      var pageLoadTime = get70PercentAverage(function(p) { return p.pageLoadTime; });
      var numStutterEvents = get70PercentAverage(function(p) { return p.numStutterEvents; });
      var usedJsMemory = get70PercentAverage(function(p) { return p.usedJsMemory; });

      var dur = padLengthRight(padLengthLeft(Math.round(totalTime) + 'ms', 29), 30);
      fps = padLengthRight(padLengthLeft(fps.toFixed(2), 6), 7);
      cpuIdle = padLengthRight(padLengthLeft(cpuIdle.toFixed(2) + '%', 9), 10);
      if (webGLCpuTime) {
        webGLCpuTime = padLengthRight(padLengthLeft(Math.round(webGLCpuTime) + 'ms (' + (webGLCpuTime*100.0/cpuTime).toFixed(2) + '%)', 17), 18);
        webGLApiCallCount = padLengthRight(padLengthLeft((webGLApiCallCount/numRenderedFrames).toFixed(2), 17), 18);
      } else {
        webGLCpuTime = '(not tracked)';
        webGLApiCallCount = '(not tracked)';
      }
      cpuTime = padLengthRight(padLengthLeft(Math.round(cpuTime) + 'ms', 9), 10);
      pageLoadTime = padLengthRight(padLengthLeft(pageLoadTime.toFixed(2) + 'ms', 15), 16);
      numStutterEvents = padLengthRight(padLengthLeft(numStutterEvents.toFixed(1)+'', 19), 20);
      usedJsMemory = padLengthLeft(usedJsMemory == 0 ? 'N/A' : (usedJsMemory/1024/1024).toFixed(1)+'MB', 12);
      s += time + '|' + n + '|' + dur + '|' + fps + '|' + cpuTime + '|' + webGLCpuTime + '|' + webGLApiCallCount + '|' + cpuIdle + '|' + pageLoadTime + '|' + numStutterEvents + '|' + usedJsMemory + '\n';
    }
  }
  s += '                  |                                       |                              |       |          |                  |          |                |                    |            \n';
  s += '</pre>';
  emrun_print(s);
  document.getElementById('full_test_results').innerHTML = s;
  var allTestsRun = (testsQueuedToRun.length == 0);
  var numTestsRun = 0;
  var numTestsFailed = 0;
  for(var i in tests) {
    var t = tests[i];
    if (t.result && t.result.result) {
      ++numTestsRun;
      if (t.result.result != 'PASS') ++numTestsFailed;
    }
  }
  if (numTestsRun > 0 && allTestsRun && autoRunEnabled) emrun_exit(numTestsFailed);
}

var fullTestLog = ' Run Date         | Test Name                             | Total time (lower is better) |   FPS | CPU Time |   WebGL CPU Time | WebGL calls/frame| CPU Idle | Page load time | # of janked frames | Used JS Mem\n';
fullTestLog += '-'.repeat(fullTestLog.length-1) + '\n';

// Harness received a completion message from a test window.
function receiveMessage(event)
{
  var testResults = event.data;
  if (!testResults || !testResults.result) return;
  emrun_print('receiveMessage: result="' + testResults.result + '"'); // Print progress indication so the harness knows we are not hung.
  if (testResults.error && testResults.error.indexOf('\n') != -1) testResults.error = testResults.error.slice(0, testResults.error.indexOf('\n'));
  testResults.noVsync = currentlyRunningNoVsync;
  testResults.fakeGL = currentlyRunningFakeGL;
  testResults.cpuProfiler = currentlyRunningCpuProfiler;
  testResults.webglProfiler = currentlyRunningWebGLProfiler;

  testResults.browserUuid = browserUuid;
  testResults.startTime = currentlyRunningTest.startTime.yyyymmddhhmmss();
  testResults.key = currentlyRunningTest.key;
  testResults.finishTime = new Date().yyyymmddhhmmss();
  testResults.name = currentlyRunningTest.name;
  testResults.totalTime = (new Date() - currentlyRunningTest.startTime);
  testResults.runUuid = currentlyRunningTest.runUuid;
  if (browserInfo && browserInfo.nativeSystemInfo && browserInfo.nativeSystemInfo.uuid) testResults.hardwareUuid = browserInfo.nativeSystemInfo.uuid;
  testResults.runOrdinal = allTestResultsByKey[testResults.key] ? (allTestResultsByKey[testResults.key].length + 1) : 1;
  resultsServer_StoreTestResults(testResults);
  post("^test^" + JSON.stringify(testResults));

  // Accumulate results in dictionary.
  if (testResults.result != 'FAIL') {
    if (!allTestResultsByKey[testResults.key]) allTestResultsByKey[testResults.key] = [];
    allTestResultsByKey[testResults.key].push(testResults);
  }

  currentlyRunningTest.result = testResults;
  fullTestLog += prettyPrintTestLogLine(currentlyRunningTest);
  var fontColor = (testResults.result.indexOf('PASS') != -1) ? '#00A000' : 'red';
  var result = (testResults.result == 'ERROR') ? ('ERROR! ' + testResults.error) : (testResults.totalTime + 'ms');
  document.getElementById('results_' + currentlyRunningTest.id).innerHTML = '<span style="color: ' + fontColor + '; font-weight: bold;">' + result + '</span>';

  var tortureMode = document.getElementById('tortureMode').checked;

  writeFullTestResults();

  if (runningTestsInProgress) {
    var testStarted = runNextQueuedTest();
    if (!testStarted) {
      if (tortureMode) {
        testsQueuedToRun = getSelectedTests();
        runSelectedTests();
      } else {
        runningTestsInProgress = false;
        currentlyRunningTest = null;
      }
    }
  } else {
    currentlyRunningTest = null;
  }
}
window.addEventListener("message", receiveMessage, false);

// http://stackoverflow.com/questions/985272/selecting-text-in-an-element-akin-to-highlighting-with-your-mouse
function selectText(element) {
  var doc = document, text = doc.getElementById(element), range, selection;
  if (doc.body.createTextRange) {
      range = document.body.createTextRange();
      range.moveToElementText(text);
      range.select();
  } else if (window.getSelection) {
      selection = window.getSelection();
      range = document.createRange();
      range.selectNodeContents(text);
      selection.removeAllRanges();
      selection.addRange(range);
  }
}
/**
 * Toggle visibility of an element
 */
function toggleVisible(buttionId, id) {
  var button = document.getElementById(buttionId);
  var element = document.getElementById(id);

  if (element.classList.contains("hidden")) {
    button.textContent = "Hide";
    element.classList.remove("hidden");
  } else {
    button.textContent = "Show";
    element.classList.add("hidden");
  }
}

function autoRun() {
  if (!currentlyRunningTest && autoRunEnabled) {
    runSelectedTests();
  }
}

function prettyPrintNativeSystemInfo(i) {
  if (!i) return '';
  var s = '';
  s += 'Computer UUID: ' + i.uuid + '\n';
  s += 'Computer name: ' + i.name + '\n';
  s += 'Model: ' + i.model + '\n';
  s += 'OS: ' + i.os + '\n';
  s += 'RAM: ' + ((i.ram / 1024 / 1024)|0) + ' MB\n';
  if (!i.cpu['model'])
    s += 'CPU: Unknown';
  else
    s += 'CPU: ' + i.cpu['model'] + ', ' + i.cpu['frequency'] + ' MHz, ' + i.cpu['physicalCores'] + ' physical cores, ' + i.cpu['logicalCores'] + ' logical cores\n';
  for(var g = 0; g < i.gpu.length; ++g) {
    s += 'GPU' + (i.gpu.length == 1 ? '' : g) + ': ' + i.gpu[g].model + ' with ' + ((i.gpu[g].ram / 1024 / 1024)|0) + ' MB of VRAM\n';
  }
  return s.trim();
}

function prettyPrintBrowserInfo(i) {
  if (!i) return '';
  var s = 'Browser: ' + i.name + ' ' + i.version + '\n';
  s += 'Browser build date: ' + i.buildDate + '\n';
  return s;
}

function updateSystemInformation(results) {
  var r = prettyPrintTestResults(results);
  var s = prettyPrintNativeSystemInfo(results['nativeSystemInfo']);
  s += '\n' + prettyPrintBrowserInfo(results['browserInfo']);
  if (s) {
    s = '\nNative environment:\n' + s.trim();
    if (r) r = '\n\nWeb environment:\nBrowser UUID: ' + browserUuid + '\n' + r.trim();
  }
  document.getElementById('system_information').innerHTML = '<pre>\n' + document.getElementById('version').innerHTML + '\n' + s + r + '</div>';
}

function generateUUID() {
  if (window.crypto && window.crypto.getRandomValues) {
    var buf = new Uint16Array(8);
    window.crypto.getRandomValues(buf);
    var S4 = function(num) { var ret = num.toString(16); while(ret.length < 4) ret = "0"+ret; return ret; };
    return S4(buf[0])+S4(buf[1])+"-"+S4(buf[2])+"-"+S4(buf[3])+"-"+S4(buf[4])+"-"+S4(buf[5])+S4(buf[6])+S4(buf[7]);
  } else {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
      var r = Math.random()*16|0, v = c == 'x' ? r : (r&0x3|0x8);
      return v.toString(16);
    });
  }
}

// Hashes the given text to a UUID string of form "xxxxxxxx-yyyy-zzzz-wwww-aaaaaaaaaaaa".
function hashToUuid(text) {
  var shaObj = new jsSHA("SHA-256", "TEXT");
  shaObj.update(text);
  var hash = shaObj.getHash("ARRAYBUFFER");
  var n = '';
  for(var i = 0; i < hash.byteLength/2; ++i) {
    var s = (hash[i] ^ hash[i+8]).toString(16);
    if (s.length == 1) s = '0' + s;
    n += s;
  }
  return n.slice(0, 8) + '-' + n.slice(8, 12) + '-' + n.slice(12, 16) + '-' + n.slice(16, 20) + '-' + n.slice(20);
}

var browserUuid = '';

function onBrowserResultsReceived(results) {
  browserInfo = results;

  var hardwareUuid = '';
  if (browserInfo['nativeSystemInfo'] && browserInfo['nativeSystemInfo']['uuid']) {
    hardwareUuid = browserInfo['nativeSystemInfo']['uuid'];
  } else {
    hardwareUuid = localStorage.getItem("uuid");
    if (!hardwareUuid) {
      hardwareUuid = generateUUID();
      localStorage.setItem("uuid", hardwareUuid);
    }
  }

  // We now have all the info to compute the browser UUID
  var browserUuidString = hardwareUuid + (browserInfo['buildID'] || '');
  if (browserInfo['browserInfo']) browserUuidString += (browserInfo['browserInfo'].version || '');
  browserUuid = hashToUuid(browserUuidString);
  results.browserUuid = browserUuid;

  updateSystemInformation(results);
  writeFullTestResults();
  resultsServer_StoreSystemInfo(results);
  post("^sys^" + JSON.stringify(results));
  autoRun();
}

var browserInfoPromise = browserFeatureTestAsPromise();

// Fetch information about native system if we are running as localhost.
function fetchNativeSystemInfo() {
  var promise = new Promise(function(resolve, reject) {
    var nativeSystemInfo = null;
    var systemInfo = new XMLHttpRequest();
    systemInfo.onreadystatechange = function() {
      if (systemInfo.readyState != 4) return;
      try {
        var nativeSystemInfo = JSON.parse(systemInfo.responseText);
        resolve(nativeSystemInfo);
      } catch(e) {
        resolve({});
      }
    }
    systemInfo.open("POST", "system_info", true);
    systemInfo.send();
  });
  return promise;
}
var nativeInfoPromise;
if (location.href.indexOf('http://localhost') == 0) {
  nativeInfoPromise = fetchNativeSystemInfo();
} else {
  nativeInfoPromise = new Promise(function(resolve, reject) { setTimeout(function() { resolve(); }, 1); });
}

Promise.all([browserInfoPromise, nativeInfoPromise]).then(function(allResults) {
  var browserInfo = allResults[0];
  var nativeInfo = allResults[1];
  if (nativeInfo) {
    browserInfo['nativeSystemInfo'] = nativeInfo['system'];
    browserInfo['browserInfo'] = nativeInfo['browser'];
  }
  browserInfo['browserUuid'] = browserUuid;
  onBrowserResultsReceived(browserInfo);
}, function() {
  console.error('browser info test failed!');
});
