const path = require('path');
const _ = require('lodash');
const Extractor = require('angular-gettext-tools').Extractor;
const loaderUtils = require("loader-utils");

exports.default = function (source) {
  const callback = this.async();
  var loaderOptions = loaderUtils.getOptions(this) || {};
  const options = _.cloneDeep(loaderOptions);
  const possibleExtensions = _.keys(options.extensions);
  const extractor = new Extractor(options);

  extractor.parse(path.relative(this.rootContext || '', this.resourcePath), source);

  this.emitData && this.emitData(this.resourcePath, extractor.strings);
  callback(null, source);
}

function extractExtension(request) {
  return request && request.split('.').pop();
}
