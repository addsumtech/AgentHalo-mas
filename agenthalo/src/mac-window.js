// src/mac-window.js - macOS-only NSWindow tweaks that Electron does not expose.

const isMac = process.platform === "darwin";

// Values from AppKit's NSWindowCollectionBehavior enum.
const NSWindowCollectionBehaviorCanJoinAllSpaces = 1 << 0;
const NSWindowCollectionBehaviorMoveToActiveSpace = 1 << 1;
const NSWindowCollectionBehaviorManaged = 1 << 2;
const NSWindowCollectionBehaviorTransient = 1 << 3;
const NSWindowCollectionBehaviorStationary = 1 << 4;
const NSWindowCollectionBehaviorParticipatesInCycle = 1 << 5;
const NSWindowCollectionBehaviorIgnoresCycle = 1 << 6;
const NSWindowCollectionBehaviorFullScreenPrimary = 1 << 7;
const NSWindowCollectionBehaviorFullScreenAuxiliary = 1 << 8;
const NSWindowCollectionBehaviorFullScreenNone = 1 << 9;
const NSWindowCollectionBehaviorFullScreenAllowsTiling = 1 << 11;
const NSWindowCollectionBehaviorFullScreenDisallowsTiling = 1 << 12;
const NSWindowCollectionBehaviorPrimary = 1 << 16;
const NSWindowCollectionBehaviorAuxiliary = 1 << 17;
const NSWindowCollectionBehaviorCanJoinAllApplications = 1 << 18;
const NSWindowAnimationBehaviorNone = 2;
const CGAssistiveTechHighWindowLevel = 1500;

let objc = null;
let selWindow = null;
let selCollectionBehavior = null;
let selSetCollectionBehavior = null;
let selSetAnimationBehavior = null;
let selSetCanHide = null;
let selSetHidesOnDeactivate = null;
let selSetMovable = null;
let selSetLevel = null;
let warnedApplyFailure = false;

function initObjc() {
  if (objc) return objc;

  const koffi = require("koffi");
  const libobjc = koffi.load("/usr/lib/libobjc.A.dylib");
  const sel_registerName = libobjc.func("void *sel_registerName(const char *name)");

  objc = {
    msgPtr: libobjc.func("objc_msgSend", "void *", ["void *", "void *"]),
    msgULong: libobjc.func("objc_msgSend", "ulong", ["void *", "void *"]),
    msgVoidULong: libobjc.func("objc_msgSend", "void", ["void *", "void *", "ulong"]),
    msgVoidLong: libobjc.func("objc_msgSend", "void", ["void *", "void *", "long"]),
    msgVoidBool: libobjc.func("objc_msgSend", "void", ["void *", "void *", "bool"]),
  };

  selWindow = sel_registerName("window");
  selCollectionBehavior = sel_registerName("collectionBehavior");
  selSetCollectionBehavior = sel_registerName("setCollectionBehavior:");
  selSetAnimationBehavior = sel_registerName("setAnimationBehavior:");
  selSetCanHide = sel_registerName("setCanHide:");
  selSetHidesOnDeactivate = sel_registerName("setHidesOnDeactivate:");
  selSetMovable = sel_registerName("setMovable:");
  selSetLevel = sel_registerName("setLevel:");
  return objc;
}

function nativeHandleToPointer(handle) {
  if (!handle || handle.length < 8) return null;
  const ptr = handle.readBigUInt64LE(0);
  return ptr === 0n ? null : ptr;
}

// The upstream build also moved the pet into a private system-level Space via
// the private window-server framework so Space swipes would not animate it.
// App Review only allows public APIs (guideline 2.5.1), so the store build keeps
// the public AppKit collection behavior below and reports "not delegated";
// topmost-runtime then applies Electron's all-Spaces setting as well.
function delegateWindowToStationarySpace(_nsWindow) {
  return false;
}

function applyStationaryCollectionBehavior(browserWindow) {
  if (!isMac || !browserWindow || browserWindow.isDestroyed()) return false;

  try {
    const { msgPtr, msgULong, msgVoidULong, msgVoidLong, msgVoidBool } = initObjc();
    const nsView = nativeHandleToPointer(browserWindow.getNativeWindowHandle());
    if (!nsView) return false;

    // Electron exposes NSView*. The collection behavior lives on its NSWindow.
    const nsWindow = msgPtr(nsView, selWindow);
    if (!nsWindow) return false;

    const current = Number(msgULong(nsWindow, selCollectionBehavior)) || 0;
    const clearMask =
      NSWindowCollectionBehaviorMoveToActiveSpace |
      NSWindowCollectionBehaviorManaged |
      NSWindowCollectionBehaviorTransient |
      NSWindowCollectionBehaviorParticipatesInCycle |
      NSWindowCollectionBehaviorFullScreenPrimary |
      NSWindowCollectionBehaviorFullScreenNone |
      NSWindowCollectionBehaviorFullScreenAllowsTiling |
      NSWindowCollectionBehaviorPrimary |
      NSWindowCollectionBehaviorAuxiliary |
      NSWindowCollectionBehaviorCanJoinAllApplications;
    const setMask =
      NSWindowCollectionBehaviorCanJoinAllSpaces |
      NSWindowCollectionBehaviorStationary |
      NSWindowCollectionBehaviorFullScreenAuxiliary |
      NSWindowCollectionBehaviorIgnoresCycle |
      NSWindowCollectionBehaviorFullScreenDisallowsTiling;
    const next = (current & ~clearMask) | setMask;

    if (next !== current) {
      msgVoidULong(nsWindow, selSetCollectionBehavior, next);
    }
    msgVoidBool(nsWindow, selSetCanHide, false);
    msgVoidBool(nsWindow, selSetHidesOnDeactivate, false);
    msgVoidBool(nsWindow, selSetMovable, false);
    msgVoidLong(nsWindow, selSetAnimationBehavior, NSWindowAnimationBehaviorNone);
    msgVoidLong(nsWindow, selSetLevel, CGAssistiveTechHighWindowLevel);
    return delegateWindowToStationarySpace(nsWindow);
  } catch (err) {
    if (!warnedApplyFailure) {
      console.warn("AgentHalo: failed to apply macOS stationary window behavior:", err.message);
      warnedApplyFailure = true;
    }
    return false;
  }
}

// #640 Phase 2 pulled the pet out of that private Space while a bubble text
// field was being edited. Without the private Space there is nothing to pull it
// out of, so this reports "unavailable" and topmost-runtime falls back to fading
// the pet and making its hit window click-through.
function deDelegateWindowFromStationarySpace(_browserWindow, _level = 0) {
  return false;
}

module.exports = {
  applyStationaryCollectionBehavior,
  deDelegateWindowFromStationarySpace,
};
