#!/usr/bin/env python3

import errno, os, os.path, shutil, stat, sys, zipfile
from urllib.parse import quote
from urllib.request import urlopen

ROOT = os.path.dirname(os.path.realpath(__file__))
TTY_OUTPUT = sys.stdout.isatty()

WINDOWS = os.name == 'nt' or (os.getenv('SYSTEMROOT') is not None and 'windows' in os.getenv('SYSTEMROOT').lower()) or (os.getenv('COMSPEC') is not None and 'windows' in os.getenv('COMSPEC').lower())

# Removes a single file, suppressing exceptions on failure.
def rmfile(filename):
  try:
    os.remove(filename)
  except:
    pass

# Removes a directory tree even if it was readonly, and doesn't throw exception on failure.
def remove_tree(d):
  try:
    def remove_readonly_and_try_again(func, path, exc_info):
      if not (os.stat(path).st_mode & stat.S_IWRITE):
        os.chmod(path, stat.S_IWRITE)
        func(path)
      else:
        raise
    shutil.rmtree(d, onerror=remove_readonly_and_try_again)
  except Exception as e:
    pass

# http://stackoverflow.com/questions/600268/mkdir-p-functionality-in-python
def mkdir_p(path):
  if os.path.exists(path):
    return
  try:
    os.makedirs(path)
  except OSError as exc: # Python >2.5
    if exc.errno == errno.EEXIST and os.path.isdir(path):
      pass
    else: raise

def get_content_length(download):
  try:
    meta = download.info()
    if hasattr(meta, "getheaders") and hasattr(meta.getheaders, "Content-Length"): return int(meta.getheaders("Content-Length")[0])
    elif hasattr(download, "getheader") and download.getheader('Content-Length'): return int(download.getheader('Content-Length'))
    elif hasattr(meta, "getheader") and meta.getheader('Content-Length'): return int(meta.getheader('Content-Length'))
  except Exception:
    pass

  return 0

# On success, returns the filename on the disk pointing to the destination file that was produced
# On failure, returns None.
def download_file(url, dstpath, download_even_if_exists=False):
  file_name = os.path.join(dstpath, 'temp.zip')
  if os.path.exists(file_name) and not download_even_if_exists:
    print("File '" + file_name + "' already downloaded, skipping.")
    return file_name
  try:
    u = urlopen(url)
    mkdir_p(os.path.dirname(file_name))
    with open(file_name, 'wb') as f:
      file_size = get_content_length(u)
      if file_size > 0: print("Downloading: %s from %s, %s Bytes" % (file_name, url, file_size))
      else: print("Downloading: %s from %s" % (file_name, url))

      file_size_dl = 0
      # Draw a progress bar 80 chars wide (in non-TTY mode)
      progress_max = 80 - 4
      progress_shown = 0
      block_sz = 8192
      if not TTY_OUTPUT:
          print(' [', end='')
      while True:
          buffer = u.read(block_sz)
          if not buffer:
              break

          file_size_dl += len(buffer)
          f.write(buffer)
          if file_size:
              percent = file_size_dl * 100.0 / file_size
              if TTY_OUTPUT:
                  status = r" %10d  [%3.02f%%]" % (file_size_dl, percent)
                  print(status, end='\r')
              else:
                  while progress_shown < progress_max * percent / 100:
                      print('-', end='')
                      sys.stdout.flush()
                      progress_shown += 1
      if not TTY_OUTPUT:
          print(']')
  except Exception as e:
    print("Error downloading URL '" + url + "': " + str(e))
    rmfile(file_name)
    return None
  except KeyboardInterrupt as e:
    print("Aborted by User, exiting")
    rmfile(file_name)
    sys.exit(1)
  return file_name

def num_files_in_directory(path):
  if not os.path.isdir(path):
    return 0
  return len([name for name in os.listdir(path) if os.path.exists(os.path.join(path, name))])

# On Windows, it is not possible to reference path names that are longer than ~260 characters, unless the path is referenced via a "\\?\" prefix.
# See https://msdn.microsoft.com/en-us/library/aa365247.aspx#maxpath and http://stackoverflow.com/questions/3555527/python-win32-filename-length-workaround
# In that mode, forward slashes cannot be used as delimiters.
def fix_potentially_long_windows_pathname(pathname):
  if not WINDOWS: return pathname
  if not os.path.isabs(pathname) and len(pathname) > 200: print('Warning: Seeing a relative path "' + pathname + '" which is dangerously long for being referenced as a short Windows path name. Refactor emsdk to be able to handle this!')
  if pathname.startswith('\\\\?\\'): return pathname
  return '\\\\?\\' + os.path.normpath(pathname.replace('/', '\\'))

# On windows, rename/move will fail if the destination exists, and there is no
# race-free way to do it. This method removes the destination if it exists, so
# the move always works
def move_with_overwrite(src, dest):
  if os.path.exists(dest):
    os.remove(dest)
  os.rename(src, dest)

# http://stackoverflow.com/questions/12886768/simple-way-to-unzip-file-in-python-on-all-oses
def unzip(source_filename, dest_dir, unpack_even_if_exists=False):
  if WINDOWS: dest_dir = dest_dir.replace('\\', '/')
  if not unpack_even_if_exists and num_files_in_directory(dest_dir) > 0:
    print("File '" + source_filename + "' has already been unpacked, skipping.")
    return True
  print("Unpacking '" + source_filename + "' to '" + dest_dir + "'")
  mkdir_p(dest_dir)
  common_subdir = None
  try:
    with zipfile.ZipFile(source_filename) as zf:
      # Implement '--strip 1' behavior to unzipping by testing if all the files in the zip reside in a common subdirectory, and if so,
      # we move the output tree at the end of uncompression step.
      for member in zf.infolist():
        words = member.filename.split('/')
        if len(words) > 1: # If there is a directory component?
          if common_subdir is None:
            common_subdir = words[0]
          elif common_subdir != words[0]:
            common_subdir = None
            break
        else:
          common_subdir = None
          break

      unzip_to_dir = dest_dir
      if common_subdir:
        unzip_to_dir = os.path.join('/'.join(dest_dir.split('/')[:-1]), 'unzip_temp')

      # Now do the actual decompress.
      for member in zf.infolist():
        zf.extract(member, fix_potentially_long_windows_pathname(unzip_to_dir))

        # Move the extracted file to its final location without the base directory name, if we are stripping that away.
        if common_subdir:
          if not member.filename.startswith(common_subdir):
            raise Exception('Unexpected filename "' + member.filename + '"!')
          stripped_filename = '.' + member.filename[len(common_subdir):]
          final_dst_filename = os.path.join(dest_dir, stripped_filename)
          if stripped_filename.endswith('/'): # Directory?
            d = fix_potentially_long_windows_pathname(final_dst_filename)
            if not os.path.isdir(d): os.mkdir(d)
          else:
            tmp_dst_filename = os.path.join(unzip_to_dir, member.filename)
            parent_dir = os.path.dirname(fix_potentially_long_windows_pathname(final_dst_filename))
            if parent_dir and not os.path.exists(parent_dir):
              os.makedirs(parent_dir)
            move_with_overwrite(fix_potentially_long_windows_pathname(tmp_dst_filename), fix_potentially_long_windows_pathname(final_dst_filename))

      if common_subdir:
        try:
          remove_tree(unzip_to_dir)
        except:
          pass
  except zipfile.BadZipfile as e:
    print("Unzipping file '" + source_filename + "' failed due to reason: " + str(e) + "! Removing the corrupted zip file.")
    rmfile(source_filename)
    return False
  except Exception as e:
    print("Unzipping file '" + source_filename + "' failed due to reason: " + str(e))
    return False

  return True

def download_and_unzip(url, dest_dir, download_even_if_exists=False):
  download_target = dest_dir

  # If the archive was already downloaded, and the directory it would be
  # unpacked to has contents, assume it's the same contents and skip.
  if not download_even_if_exists and os.path.exists(download_target) and num_files_in_directory(dest_dir) > 0:
    print(dest_dir + " already exists, skipping.")
    return True
  # Otherwise, if the archive must be downloaded, always write into the
  # target directory, since it may be a new version of a tool that gets
  # installed to the same place (that is, a different download name
  # indicates different contents).
  download_even_if_exists = True

  received_download_target = download_file(url, ROOT, download_even_if_exists)
  unzip(received_download_target, dest_dir, unpack_even_if_exists=download_even_if_exists)
  os.remove(received_download_target)

def main():
  tests = [
    'BoatAttack_20190722_175007_wasm_release_profiling',
    'kart-template_20190725_130858_wasm_release_profiling',
    'LWRPTemplate_20190919_204458_wasm_release_profiling',
    'microgame-fps_20190922_131915_wasm_release_profiling',
    'RubysAdventure_20190722_201255_wasm_release_profiling',
    'TheExplorer_20190723_140034_wasm_release_profiling',
    'Tanks_20191004_152744_wasm_release_profiling',
    'LostCrypt_20191220_131436_wasm_release',
    'TinyRacing-Wasm-Release-2019-12-12',
    'TinyRacing-Wasm-Release-2020-01-24',
    'Tiny3D-Wasm-Release-2020-03-01',
    'fastcomp-tinyracing-asmjs-release-2020-03-17',
    'fastcomp-tinyracing-wasm-release-2020-03-17',
    'llvm-tinyracing-asmjs-release-closure-2020-03-17',
    'llvm-tinyracing-wasm-release-2020-03-17',
    'Tiny3D-ClassicUnity-2020-04-20',
    'Skelebuddies-Wasm2JS-Release-2020-10-26-profiling',
    'Skelebuddies-Wasm-Release-2020-10-26-profiling',
    'com.unity.template.kart_20210304_144749_wasm_release_profiling',
    'com.unity.template.kart_20210305_102729_wasm_release_profiling',
    'BoatAttack_2020.2.4',
    'BoatAttack_2021.2',
    'Dragon Crashers_20210429_121455_wasm_release_profiling'
  ]
  for t in tests:
    # Remove old installed tests from root directory (if any existed using the old structure)
    if os.path.isdir(os.path.join(ROOT, t)):
      shutil.rmtree(os.path.join(ROOT, t))

    # Install new tests to demos/ directory
    url = f'http://clb.confined.space/emunittest_unity/{quote(t)}.zip'
    download_and_unzip(url, os.path.join(ROOT, 'demos', t))

if __name__ == '__main__':
  sys.exit(main())
