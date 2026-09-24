// Same-process lock primitive only. No paths, persistent data or child process.
// JS boundary: Node-API v8. Windows FD conversion uses Node's public libuv API;
// do not use V8 or Node's unstable C++ interfaces.
#define NAPI_VERSION 8
#include <node_api.h>
#include <limits.h>
#include <math.h>
#include <stdbool.h>
#ifdef _WIN32
#define USING_UV_SHARED 1
#include <uv.h>
// Node owns the descriptor's CRT table. Resolve through its libuv export,
// never the addon's CRT; the returned handle remains owned by the open fd.
#else
#include <sys/file.h>
#include <errno.h>
#endif

static bool descriptor(napi_env env, napi_callback_info info, int *fd) {
  size_t count = 2;
  napi_value args[2];
  double number;
  if (napi_get_cb_info(env, info, &count, args, NULL, NULL) != napi_ok
      || count != 1 || napi_get_value_double(env, args[0], &number) != napi_ok
      || !isfinite(number) || number < 0 || number > INT_MAX || floor(number) != number) {
    napi_throw_type_error(env, "LOCK_DESCRIPTOR_INVALID", "Expected one open file descriptor");
    return false;
  }
  *fd = (int)number;
  return true;
}

static napi_value try_lock(napi_env env, napi_callback_info info) {
  int fd;
  if (!descriptor(env, info, &fd)) return NULL;
  bool acquired;
#ifdef _WIN32
  const intptr_t raw = (intptr_t)uv_get_osfhandle(fd);
  if (raw == -1 || raw == -2) {
    napi_throw_error(env, "LOCK_DESCRIPTOR_INVALID", "Invalid open file descriptor");
    return NULL;
  }
  OVERLAPPED overlap = {0};
  acquired = LockFileEx((HANDLE)raw, LOCKFILE_EXCLUSIVE_LOCK | LOCKFILE_FAIL_IMMEDIATELY,
      0, 1, 0, &overlap) != 0;
  if (!acquired && GetLastError() != ERROR_LOCK_VIOLATION) {
    napi_throw_error(env, "LOCK_SYSTEM_ERROR", "Operating system could not acquire file lock");
    return NULL;
  }
#else
  int result;
  do { result = flock(fd, LOCK_EX | LOCK_NB); } while (result == -1 && errno == EINTR);
  acquired = result == 0;
  if (!acquired && errno != EWOULDBLOCK && errno != EAGAIN) {
    napi_throw_error(env, errno == EBADF ? "LOCK_DESCRIPTOR_INVALID" : "LOCK_SYSTEM_ERROR", "Operating system could not acquire file lock");
    return NULL;
  }
#endif
  napi_value value;
  if (napi_get_boolean(env, acquired, &value) != napi_ok) return NULL;
  return value;
}

static napi_value unlock(napi_env env, napi_callback_info info) {
  int fd;
  if (!descriptor(env, info, &fd)) return NULL;
#ifdef _WIN32
  const intptr_t raw = (intptr_t)uv_get_osfhandle(fd);
  OVERLAPPED overlap = {0};
  if (raw == -1 || raw == -2 || !UnlockFileEx((HANDLE)raw, 0, 1, 0, &overlap)) {
#else
  int result;
  do { result = flock(fd, LOCK_UN); } while (result == -1 && errno == EINTR);
  if (result != 0) {
#endif
    napi_throw_error(env, "LOCK_SYSTEM_ERROR", "Operating system could not release file lock");
    return NULL;
  }
  napi_value value;
  if (napi_get_undefined(env, &value) != napi_ok) return NULL;
  return value;
}

NAPI_MODULE_INIT() {
  napi_property_descriptor properties[] = {
    {"tryLock", NULL, try_lock, NULL, NULL, NULL, napi_default, NULL},
    {"unlock", NULL, unlock, NULL, NULL, NULL, napi_default, NULL}
  };
  if (napi_define_properties(env, exports, 2, properties) != napi_ok) return NULL;
  napi_value version;
  if (napi_create_uint32(env, 8, &version) != napi_ok
      || napi_set_named_property(env, exports, "napiVersion", version) != napi_ok) return NULL;
  return exports;
}
