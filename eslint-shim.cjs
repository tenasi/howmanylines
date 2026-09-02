const Module = require("node:module");
const originalRequire = Module.prototype.require;

Module.prototype.require = function (id) {
  if (id === "typescript") {
    return originalRequire.call(this, "@typescript/typescript6");
  }
  return originalRequire.apply(this, arguments);
};

try {
  const req = Module.createRequire(__filename);
  const fileContextPath = req
    .resolve("eslint/package.json")
    .replace("package.json", "lib/linter/file-context.js");
  const { FileContext } = req(fileContextPath);
  if (FileContext && FileContext.prototype) {
    if (!FileContext.prototype.getFilename) {
      FileContext.prototype.getFilename = function () {
        return this.filename;
      };
    }
    if (!FileContext.prototype.getPhysicalFilename) {
      FileContext.prototype.getPhysicalFilename = function () {
        return this.physicalFilename;
      };
    }
    if (!FileContext.prototype.getCwd) {
      FileContext.prototype.getCwd = function () {
        return this.cwd;
      };
    }
    if (!FileContext.prototype.getSourceCode) {
      FileContext.prototype.getSourceCode = function () {
        return this.sourceCode;
      };
    }
  }
} catch (e) {
  // Ignored if eslint internals change
}
