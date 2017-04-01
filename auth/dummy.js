/**
 * Dummy authentication module that allows any username/password
 * combination in.
 * @param {any} opts authentication options
 * @param {any} cb callback to call with (auth-error, updated-opts)
 */
module.exports = function dummy (opts, cb) {
  cb(null, opts)
}
