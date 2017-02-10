const debug = require('debug')('medium:router')

function Router (opts = {}) {
  this.opts = opts
  this.redis = opts.redis || require('redis-node').createClient()
  this.redsub = opts.redsub || require('redis-node').createClient()
}

Router.prototype.route = function (jid, stanza) {
  this.redis.publish(jid, stanza.toString())
}

Router.prototype.registerRoute = function (jid, client) {
  debug('registered route %s -> %s', jid, client.id)
  this.redsub.subscribeTo(jid, (channel, stanza, pattern) => {
    client.send(stanza)
  })
  return true
}

Router.prototype.unregisterRoute = function (jid, client) {
  debug('unregistered route %s -> %s', jid, client.id)
  this.redsub.unsubscribeFrom(jid)
  return true
}

module.exports = Router
