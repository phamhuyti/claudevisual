const Module = require("module");
const path = require("path");
const stub = path.join(__dirname, "vscode-stub.js");

const original = Module._resolveFilename;
Module._resolveFilename = function (request, parent, isMain, options) {
  if (request === "vscode") {
    return stub;
  }
  return original.call(this, request, parent, isMain, options);
};
