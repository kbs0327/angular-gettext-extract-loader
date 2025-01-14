const path = require('path');
const _ = require('lodash');
const Extractor = require('angular-gettext-tools').Extractor;
const loaderUtils = require("loader-utils");

exports.default = function (source) {
  const callback = this.async();
  var loaderOptions = loaderUtils.getOptions(this) || {};
  const options = _.cloneDeep(loaderOptions);
  const possibleExtensions = _.keys(options.extensions);
  const fullPath = path.join(this.rootContext || '', this.resourcePath);
  const isExcluded = options.exclude && new RegExp(options.exclude).test(fullPath);
  if (
      !isExcluded &&
      this.request.lastIndexOf('.vue?vue') === -1 &&
      _.includes(possibleExtensions, extractExtension(this.resourcePath))
  ) {
    const extractor = new Extractor(options);
    extractor.parse(fullPath, source);
    this.emitData && !_.isEmpty(extractor.strings) && this.emitData(this.resourcePath, extractor.strings);
  }
  callback(null, source);
}

function extractExtension(request) {
  return request && request.split('.').pop();
}
