const debug = require('debug')('medium:router')
const redis = require('redis')
const xmpp = require('node-xmpp-core')
const EventEmitter = require('events')
const junction = require('junction')
const pjson = require('../package.json')
const os = require('os')

function Router (opts = {}) {
  this.opts = opts
  this.db = opts.db || 0
  this.prefix = opts.prefix ? opts.prefix + '/' : undefined
  this.redis = opts.redis ||
    redis.createClient({ db: this.db, prefix: this.prefix })
  this.redsub = opts.redsub || this.redis.duplicate()

  // route messaging
  this._channelEmitter = new EventEmitter()
  this.redsub.on('message', this.onMessage.bind(this))

  // queue messaging
  this.queuePrefix = `__keyspace@${this.redsub.options.db}__:queue:`
  this.redsub.config('SET', 'notify-keyspace-events', 'Kl')
  this.redsub.psubscribe(this.queuePrefix + '*')
  this.redsub.on('pmessage', this.onPMessage.bind(this))

  // process packet to server
  var server = this.server = junction()
  if (process.env.DEBUG) {
    server.use(junction.dump({ prefix: 'SERVER: ' }))
  }
  server
    .use(require('junction-lastactivity')())
    .use(require('junction-ping')())
    .use(
      require('junction-softwareversion')(pjson.name, pjson.version, os.type())
    )
    .use(require('junction-time')())
    .use(
      junction.middleware.serviceDiscovery(
        [ { category: 'server', type: 'im' } ],
        [
          'http://jabber.org/protocol/disco#info',
          // 'http://jabber.org/protocol/disco#items', // FIXME
          'jabber:iq:last',
          'urn:xmpp:ping',
          'jabber:iq:version',
          'urn:xmpp:time'
        ]
      )
    )
  server.use(junction.serviceUnavailable()).use(junction.errorHandler())

  // process packet to client
  var user = this.user = junction()
  user.use(junction.presenceParser())
  if (process.env.DEBUG) {
    user.use(junction.dump({ prefix: 'USER: ' }))
  }
  user.use(require('junction-lastactivity')()).use(Router.deliver(this))
  user.use(junction.serviceUnavailable()).use(junction.errorHandler())
}

module.exports = Router

/* Push stanza to directly connected client(s)
 */
Router.prototype.route = function (jid, stanza) {
  if (!jid) {
    throw new Error('Queue jid required')
  }
  debug('route %s %s', jid, stanza)
  this.redis.publish('route:' + jid, stanza.toString())
}

Router.prototype.registerRoute = function (jid, client) {
  if (!client || !client.id) {
    throw new Error('Invalid client to subscribe')
  }
  var channel = 'route:' + jid
  var listener = (stanza) => {
    debug('got stanza', stanza)
    client.send(stanza)
  }
  listener.client = client
  this._channelEmitter.addListener(channel, listener)
  this.redsub.subscribe(channel, function (err, reply) {
    if (err) throw err // TODO Analyze this
    debug('registered route %s -> %s', jid, client.id)
  })
}

Router.prototype.unregisterRoute = function (jid, client) {
  if (!client || !client.id) {
    throw new Error('Invalid client to unsubscribe')
  }
  var channel = 'route:' + jid
  var listener = this._channelEmitter.listeners(channel).find(listener => listener.client === client)
  if (!listener) {
    // FIXME throw new Error(`No listener for ${client.id} on ${channel}`)
    return
  }
  this._channelEmitter.removeListener(channel, listener)
  this.redsub.unsubscribe(channel, function (err, reply) {
    if (err) throw err // TODO Analyze this
    debug('unregistered route %s -> %s', jid, client.id)
  })
}

Router.prototype.onMessage = function (channel, message) {
  debug('message', channel, message)
  this._channelEmitter.emit(channel, message)
}

/* Enqueue delivery to JID
 */
Router.prototype.queue = function (jid, stanza) {
  if (!jid) {
    throw new Error('Queue jid required')
  }
  debug('queue %s %s', jid, stanza)
  this.redis.lpush('queue:' + jid, stanza.toString(), function (err, res) {
    if (err) debug('queue %s FAILED', err)
  })
}

Router.prototype.onPMessage = function (pattern, channel, message) {
  debug('pmessage', pattern, channel, message)
  if (message === 'lpush' && channel.startsWith(this.queuePrefix)) {
    let queue = channel.substr(this.queuePrefix.length)
    let jid = new xmpp.JID(queue)
    queue = `queue:${queue}`
    if (!jid) {
      throw new Error(`Cannot handle ${queue}`)
    }
    // FIXME!!!
    this.redis.lrange(queue, 0, -1, function (err, elements) {
      debug(queue, err, elements)
    })
    // 1. lock queue
    // 2. rpull from queue
    // 3. if no more, unlock queue, break
    // 4. dispatch stanza to other queues
    // 5. prolong lock
    // 6. goto 1
    if (jid.local) {
      // to user
      if (jid.resource) {
      } else {
        // this.user.handle(stanza)
      }
    } else {
      // this.server.handle(stanza)
    }
  }
}

/* Process server inbound stanza (from c2s, s2s or internally generated)
 */
Router.prototype.process = function (stanza) {
  debug('process %s', stanza)
  // http://xmpp.org/rfcs/rfc6120.html#stanzas-attributes-to-c2s
  let jid = stanza.attrs.to
    ? new xmpp.JID(stanza.attrs.to)
    : new xmpp.JID(stanza.attrs.from).bare()
  if (jid.local) {
    // to user
    if (jid.resource) {
      // direct
      this.route(jid, stanza)
    } else {
      // dispatched
      this.queue(jid, stanza)
    }
  } else {
    // to server
    this.queue(jid, stanza)
  }
}

Router.prototype.isLocal = function (domain) {
  // FIXME actually check if this is a local domain
  return true
}
// const r = new xmpp.Router()
// pull packets off router, check validity (proper from, to in serviced domain)
// pass them to application
//
// pull packets from c2s, check validity (replace from with full jid, remove to if self bare jid)
// pass them to application
//
// application build chain similar to what jabberd2 has
//
// chain local delivery through redis message queues at the end of app
//
// pull packets from queues and pass through app

/* Delivers stanzas addressed to BareJID to connected FullJIDs
 */
Router.deliver = function (router) {
  return function deliver (stanza, next) {
    // http://xmpp.org/rfcs/rfc6121.html#rules-localpart-barejid
    if (!stanza.attrs.to) return next()
    let jid = new xmpp.JID(stanza.attrs.to)
    if (router.isLocal(jid.domain) && jid.local && !jid.resource) {
      if (stanza.is('message')) {
        let type = stanza.attrs.type || 'normal'
        switch (type) {
          case 'normal':
          case 'chat':
          case 'headline':
            // http://xmpp.org/rfcs/rfc6121.html#rules-localpart-barejid-resource
            // TODO specific rules are a bit different here, bit for now this will do
            router.route(jid, stanza)
            return
          default:
            // rest - silently ignore
            return
        }
      }
    } else next()
  }
}
