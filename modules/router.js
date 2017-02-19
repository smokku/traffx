const debug = require('debug')('medium:router')
const redis = require('redis')
const Redlock = require('redlock')
const xmpp = require('node-xmpp-core')
const EventEmitter = require('events')
const junction = require('junction')
const pjson = require('../package.json')
const os = require('os')

const markerLocal = '!'
const markerRemote = '^'

function Router (opts = {}) {
  this.opts = opts

  this.router = opts.router

  this.db = opts.db || 0
  this.prefix = opts.prefix ? opts.prefix + '/' : undefined
  this.redis = opts.redis ||
    redis.createClient({ db: this.db, prefix: this.prefix })
  this.redsub = opts.redsub || this.redis.duplicate()
  this.redlock = new Redlock([ this.redis ])

  this.redis.on('error', console.error)
  this.redlock.on('clientError', console.error)

  // route messaging
  this._channelEmitter = new EventEmitter()
  this.redsub.on('message', this.onMessage.bind(this))

  // queue messaging
  this.queueLock = 3000
  this.queueChannel = `__keyevent@${this.redsub.options.db}__:lpush`
  this.redsub.config('SET', 'notify-keyspace-events', 'El')
  this.redsub.subscribe(this.queueChannel)

  // process packet to server
  var server = this.server = junction()
  if (process.env.DEBUG) {
    server.use(junction.dump({ prefix: 'SERVER: ' }))
  }
  server
    .use(require('junction-lastactivity')())
    .use(require('junction-ping')())
    .use(require('junction-softwareversion')(
      pjson.name, pjson.version, os.type()))
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
      ))
  server
    .use(junction.serviceUnavailable())
    .use(junction.errorHandler())

  // process packet to client
  var user = this.user = junction()
  if (process.env.DEBUG) {
    user.use(junction.dump({ prefix: 'USER: ' }))
  }
  user
    .use(junction.presenceParser())
  user
    .use(require('junction-lastactivity')())
    .use(Router.deliver(this))
  user
    .use(junction.serviceUnavailable())
    .use(junction.errorHandler())
}

module.exports = Router

/* Push stanza to directly connected client(s)
 */
Router.prototype.route = function (jid, stanza) {
  if (!jid) {
    throw new Error('Route jid required')
  }
  debug('route %s %s', jid, stanza)
  this.redis.publish('route:' + jid, stanza.toString())
}

Router.prototype.registerRoute = function (jid, client) {
  if (!client || !client.id) {
    throw new Error('Invalid client to subscribe')
  }
  var channel = 'route:' + jid
  var listener = stanza => {
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
  var listener = this._channelEmitter
    .listeners(channel)
    .find(listener => listener.client === client)
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

/* Enqueue delivery to JID
 */
Router.prototype.queue = function (local, jid, stanza) {
  if (!jid) {
    throw new Error('Queue jid required')
  }
  debug('queue %s %s', jid, stanza)
  this.redis.lpush(
    'queue:' + jid,
    (local ? markerLocal : markerRemote) + stanza.toString(),
    function (err, res) {
      if (err) console.error('queue %s', jid, err)
    }
  )
}

Router.prototype.onMessage = function (channel, message) {
  debug('message', channel, message)
  if (channel.startsWith('__')) { // keyspace notification
    if (channel === this.queueChannel) {
      let name = message.substr(`${this.prefix || ''}queue:`.length)
      let jid = new xmpp.JID(name)
      let queue = `queue:${name}`
      let lock = `lock:${name}`
      if (!jid) {
        throw new Error(`Cannot handle ${queue}`)
      }
      let processQueue = lock => {
        this.redis.rpop(queue, (err, stanza) => {
          if (err) {
            console.error('queue %s', queue, err)
          }
          if (!err && stanza) {
            let local = stanza[0] === markerLocal
            stanza = stanza.slice(1)
            this.dispatch(local, jid, stanza)
            // extend lock and process next queue stanza
            // if failed to extend, this means that someone else is processing
            // the queue already, so we are ok with this
            lock.extend(this.queueLock).then(processQueue)
          } else {
            lock.unlock().catch(err => {
              // we weren't able to reach redis; your lock will eventually expire
              console.error('queue %s', queue, err)
            })
          }
        })
      }
      this.redlock.lock(lock, this.queueLock).then(processQueue)
    }
  } else {
    // stanza routing
    this._channelEmitter.emit(channel, message)
  }
}

/* Dispatch stanza coming from queue to other queues/routes
 */
Router.prototype.dispatch = function (local, jid, packet) {
  debug('dispatch %s', jid, packet)
  let stanza = xmpp.parse(packet)
  if (!stanza) {
    throw new Error(`Failed to dispatch: ${packet}`)
  }

  if (local) {
    let router = this

    stanza.send = function (stanza) {
      router.process(stanza)
    }

    let response = null
    if (
      stanza.is('iq') &&
        (stanza.attrs.type === 'get' || stanza.attrs.type === 'set')
    ) {
      response = new xmpp.Stanza('iq', {
        id: stanza.attrs.id,
        from: jid.toString(),
        to: stanza.attrs.from,
        type: 'result'
      })
      response.send = function () {
        router.process(this)
      }
    }

    if (jid.local) {
      // to user
      if (jid.resource) {
        throw new Error('No FullJID dispatcher') // yet?
      } else {
        this.user.handle(stanza, response, err => { if (err) console.error(err) })
      }
    } else {
      this.server.handle(stanza, response, err => { if (err) console.error(err) })
    }
  } else {
    if (jid.local || jid.resource) {
      this.queue(local, jid.domain, stanza)
    } else {
      // pass to s2s router
      if (stanza.attrs.xmlns === 'jabber:client') {
        stanza.attrs.xmlns = 'jabber:server'
      }
      this.router.send(stanza)
    }
  }
}

/* Process server inbound stanza (from c2s, s2s or internally generated)
 */
Router.prototype.process = function (stanza, local) {
  debug('process %s', stanza, local)
  if (!stanza || !stanza.attrs) {
    throw new Error('Need stanza to process')
  }
  // http://xmpp.org/rfcs/rfc6120.html#stanzas-attributes-to-c2s
  // s2s packets was already checked for proper to/from
  let to = stanza.attrs.to
    ? new xmpp.JID(stanza.attrs.to)
    : new xmpp.JID(stanza.attrs.from).bare()
  let from = new xmpp.JID(stanza.attrs.from)
  local = local != null ? local : to.domain === from.domain
  if (local && to.local && to.resource) {
    // direct
    this.route(to, stanza)
  } else {
    // dispatched
    this.queue(local, to, stanza)
  }
}

/* Delivers stanzas addressed to BareJID to connected FullJIDs
 */
Router.deliver = function (router) {
  return function deliver (stanza, next) {
    // http://xmpp.org/rfcs/rfc6121.html#rules-localpart-barejid
    if (!stanza.attrs.to) return next()
    let jid = new xmpp.JID(stanza.attrs.to)
    if (jid.local && !jid.resource) {
      if (stanza.is('message')) {
        let type = stanza.attrs.type || 'normal'
        switch (type) {
          case 'normal':
          case 'chat':
          case 'headline':
            // http://xmpp.org/rfcs/rfc6121.html#rules-localpart-barejid-resource
            // TODO specific rules are a bit different here, but for now this will do
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
