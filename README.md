# Emunittest Unity Browser WebAssembly Benchmark Suite

This repository contains a test suite for benchmarking WebAssembly based Unity content in web browsers.

It consists of a number of classic Unity and Dots/Tiny Unity compiled demos, that have been converted to run deterministically in the browser. This enables comparing browser performance, and testing against bugs.

The result data that emunittest provides looks something like this

```
 Run Date         | Test Name                             | Total time (lower is better) |   FPS | CPU Time |   WebGL CPU Time | WebGL calls/frame| CPU Idle | Page load time | # of janked frames | Used JS Mem
----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------
 2020-10-27 10:55 | Skelebuddies wasm-2020-10-26          |                      13348ms |154.00 |  11622ms |    (not tracked) |    (not tracked) |    8.71% |       237.25ms |                  6 |     166.0MB
 2020-10-27 10:56 | Skelebuddies wasm2js-2020-10-26       |                      46688ms | 43.87 |  44544ms |    (not tracked) |    (not tracked) |    1.83% |       904.22ms |                 86 |     214.4MB
 2020-10-27 10:56 | Tiny3D Unity Classic-2020-04-20       |                       7162ms |241.14 |   4487ms |    (not tracked) |    (not tracked) |   16.15% |      1626.30ms |                  5 |     114.4MB
 2020-10-27 10:56 | Tiny3D-2020-03-01                     |                       4859ms |207.34 |   1921ms |    (not tracked) |    (not tracked) |   53.81% |       309.47ms |                 17 |     190.6MB
 2020-10-27 10:56 | Lost Crypt-2019-12-20                 |                      29535ms | 75.74 |  24952ms |    (not tracked) |    (not tracked) |    4.03% |      2976.06ms |                 20 |     649.9MB
 2020-10-27 10:57 | TinyRacing v3 wasm-2020-03-18         |                      10376ms |130.01 |   8210ms |    (not tracked) |    (not tracked) |   13.36% |       220.37ms |                  8 |     145.7MB
 2020-10-27 10:57 | TinyRacing v3 wasm2js-2020-03-17      |                      16528ms | 81.74 |  14795ms |    (not tracked) |    (not tracked) |    4.35% |       460.43ms |                 48 |     174.7MB
 2020-10-27 10:57 | TinyRacing v3 fc wasm-2020-03-17      |                       9145ms |148.95 |   6657ms |    (not tracked) |    (not tracked) |   18.57% |       257.60ms |                  4 |     147.5MB
 2020-10-27 10:57 | TinyRacing v3 fc asmjs-2020-03-17     |                      11687ms |123.55 |   9013ms |    (not tracked) |    (not tracked) |   11.11% |      1007.01ms |                  6 |     168.5MB
 2020-10-27 10:58 | TinyRacing v2 RC-2020-01-24           |                      17712ms | 75.16 |  16193ms |    (not tracked) |    (not tracked) |    3.65% |       256.10ms |                  4 |     159.9MB
 2020-10-27 10:58 | TinyRacing v1-2019-12-12              |                      11353ms |118.14 |   9858ms |    (not tracked) |    (not tracked) |    7.14% |       212.35ms |                  5 |     164.9MB
 2020-10-27 10:58 | Tanks-2019-10-04                      |                       8477ms |198.45 |   6338ms |    (not tracked) |    (not tracked) |   10.25% |       743.25ms |                  4 |     168.8MB
 2020-10-27 10:58 | Microgame - FPS-2019-09-22            |                      10975ms |107.29 |   7679ms |    (not tracked) |    (not tracked) |   13.42% |      1468.69ms |                 14 |     345.2MB
 2020-10-27 10:58 | Ruby's Adventure-2019-07-22           |                       8320ms |243.49 |   4210ms |    (not tracked) |    (not tracked) |   24.59% |      1866.00ms |                  6 |     137.9MB
 2020-10-27 10:59 | The Explorer-2019-07-23               |                      17610ms | 98.13 |  11624ms |    (not tracked) |    (not tracked) |    7.39% |      4098.70ms |                 12 |     718.1MB
 2020-10-27 10:59 | LWRPTemplate-2019-09-19               |                       6836ms |104.52 |   3566ms |    (not tracked) |    (not tracked) |   11.86% |      1818.85ms |                  6 |     260.5MB
 2020-10-27 10:59 | Microgame - Kart-2019-07-25           |                      18888ms |119.61 |  11037ms |    (not tracked) |    (not tracked) |   31.48% |      1950.83ms |                 13 |     330.3MB
 2020-10-27 11:00 | BoatAttack-2019-07-22                 |                      43921ms | 51.81 |  37067ms |    (not tracked) |    (not tracked) |    2.62% |      5093.16ms |                 22 |     667.2MB
                  |                                       |                              |       |          |                  |          |                |                    |
```

# Installation

Prerequisite: a Python 3 interpreter on the `PATH`

To install the suite for local use, run

```
git clone https://github.com/Unity-Technologies/emunittest.git
cd emunittest
python install.py # or python3 install.py
```

To update an existing installation to a newer version, run

```
cd /path/to/emunittest
git pull
python install.py # or python3 install.py
```

# Running

After installing, launch `start_server.bat` (or `./start_server` on Linux and macOS) to spin up an ad hoc web server at `http://localhost:6932/` to host the content.

Then navigate to `http://localhost:6932/` to visit the launcher.

There are three main ways to run:

1. Run the full suite by clicking on `Run tests` button in the launcher. **Be sure to allow popups to help the tests to run through**
2. Run a single test by clicking on `Test` to the right side of the test name.
3. Run a single demo in interactive mode by clicking on `Launch` button next to a test. In this mode the content runs unmodified to the original build from Unity.

Additionally there are a few options to customize how the content is run, e.g. one can disable vsync (uses postMessage() to self to render instead of rAF()), embed a CPU frametime profiler graph, or run the suite in a torture test mode.

# Contact

For bugs and feedback, contact `jukkajATunity3dDOTcom`.
