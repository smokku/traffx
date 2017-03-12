'use strict'

exports.uniq = function (len = 7) {
  var ret = ''
  while (ret.length < len) {
    // start at 2 character to skip "0."
    ret += Math.random().toString(36).substr(2)
  }
  return ret.substr(0, len)
}
