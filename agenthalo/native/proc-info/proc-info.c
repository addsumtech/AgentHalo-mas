// proc-info: process facts for the sandboxed Mac App Store build.
//
// The App Sandbox refuses to exec setuid binaries and /bin/ps is setuid root,
// so every `ps` the store build spawns fails ("deny(1) forbidden-exec-sugid").
// A sandboxed process may still read other processes of the same user through
// proc_pidinfo, proc_pidpath and the KERN_PROCARGS2 sysctl, so this helper
// answers the few questions the app used to ask ps. electron-builder copies it
// to Contents/Resources/bin/proc-info and signs it with the inherit
// entitlements (build/entitlements.mas.inherit.plist);
// scripts/build-proc-info.js builds it.
//
// Usage: proc-info <pid>...   (at most 64 pids)
//
// Prints one JSON object per argument, in argument order:
//   {"pid":123,"ppid":1,"start":1790000000,"startUsec":250000,
//    "tty":"ttys003","comm":"zsh","path":"/bin/zsh","argv0":"-zsh"}
//   {"pid":123,"missing":true}   no such process, or not readable
//   {"missing":true}             the argument is not a pid
// "start" is the process start time in epoch seconds (what ps prints as
// lstart), "tty" is null without a controlling terminal, and "path" and
// "argv0" are null when the kernel does not reveal them.

#include <errno.h>
#include <libproc.h>
#include <limits.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/proc_info.h>
#include <sys/stat.h>
#include <sys/sysctl.h>
#include <sys/types.h>

#define MAX_PIDS 64
// Pseudo-terminal slaves (/dev/ttysNNN) use this character major.
#define PTS_MAJOR 16

static char *procargs;
static size_t procargs_size;

static void put_string(const char *value, size_t length) {
  if (!value) {
    fputs("null", stdout);
    return;
  }
  putchar('"');
  for (size_t i = 0; i < length && value[i]; i++) {
    unsigned char c = (unsigned char)value[i];
    if (c == '"' || c == '\\') {
      putchar('\\');
      putchar(c);
    } else if (c < 0x20 || c == 0x7f) {
      printf("\\u%04x", c);
    } else {
      putchar(c);
    }
  }
  putchar('"');
}

static int parse_pid(const char *arg, pid_t *out) {
  char *end = NULL;
  errno = 0;
  long value = strtol(arg, &end, 10);
  if (errno || end == arg || *end || value <= 0 || value > INT_MAX) return 0;
  *out = (pid_t)value;
  return 1;
}

// ps prints devname(3) of the controlling terminal. The device database may be
// out of the sandbox's reach, so name pseudo-terminals the way devfs does.
static const char *tty_name(uint32_t tdev, char *buf, size_t size) {
  dev_t dev = (dev_t)tdev;
  if (dev == NODEV) return NULL;
  const char *name = devname(dev, S_IFCHR);
  if (name && name[0] && name[0] != '#' && name[0] != '?') return name;
  if (major(dev) == PTS_MAJOR) {
    snprintf(buf, size, "ttys%03d", minor(dev));
    return buf;
  }
  return NULL;
}

// argv[0] as the process was started (what ps prints as comm). The
// KERN_PROCARGS2 buffer is: int argc, exec path, NUL padding, argv[0], ...
static const char *read_argv0(pid_t pid) {
  if (!procargs) {
    int mib[2] = { CTL_KERN, KERN_ARGMAX };
    int argmax = 0;
    size_t length = sizeof(argmax);
    if (sysctl(mib, 2, &argmax, &length, NULL, 0) != 0 || argmax <= 0) return NULL;
    procargs = malloc((size_t)argmax);
    if (!procargs) return NULL;
    procargs_size = (size_t)argmax;
  }
  int mib[3] = { CTL_KERN, KERN_PROCARGS2, pid };
  size_t size = procargs_size;
  if (sysctl(mib, 3, procargs, &size, NULL, 0) != 0 || size <= sizeof(int)) return NULL;
  int argc = 0;
  memcpy(&argc, procargs, sizeof(argc));
  if (argc < 1) return NULL;
  char *cursor = procargs + sizeof(int);
  char *end = procargs + size;
  while (cursor < end && *cursor) cursor++;
  while (cursor < end && !*cursor) cursor++;
  if (cursor >= end || !memchr(cursor, '\0', (size_t)(end - cursor))) return NULL;
  return cursor;
}

int main(int argc, char **argv) {
  if (argc < 2 || argc - 1 > MAX_PIDS) {
    fprintf(stderr, "usage: proc-info <pid>... (at most %d)\n", MAX_PIDS);
    return 2;
  }
  for (int i = 1; i < argc; i++) {
    pid_t pid;
    if (!parse_pid(argv[i], &pid)) {
      puts("{\"missing\":true}");
      continue;
    }
    struct proc_bsdinfo info;
    if (proc_pidinfo(pid, PROC_PIDTBSDINFO, 0, &info, sizeof(info)) != (int)sizeof(info)) {
      printf("{\"pid\":%d,\"missing\":true}\n", pid);
      continue;
    }
    char tty_buf[32];
    const char *tty = tty_name(info.e_tdev, tty_buf, sizeof(tty_buf));
    char path[PROC_PIDPATHINFO_MAXSIZE];
    const char *exec_path = proc_pidpath(pid, path, sizeof(path)) > 0 ? path : NULL;
    const char *argv0 = read_argv0(pid);

    printf("{\"pid\":%d,\"ppid\":%u,\"start\":%llu,\"startUsec\":%llu,\"tty\":",
      pid, info.pbi_ppid,
      (unsigned long long)info.pbi_start_tvsec, (unsigned long long)info.pbi_start_tvusec);
    put_string(tty, tty ? strlen(tty) : 0);
    fputs(",\"comm\":", stdout);
    put_string(info.pbi_comm, sizeof(info.pbi_comm));
    fputs(",\"path\":", stdout);
    put_string(exec_path, exec_path ? strlen(exec_path) : 0);
    fputs(",\"argv0\":", stdout);
    put_string(argv0, argv0 ? strlen(argv0) : 0);
    puts("}");
  }
  return fflush(stdout) == 0 ? 0 : 1;
}
