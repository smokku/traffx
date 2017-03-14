// const { StanzaError } = require('junction')
const { JID } = require('node-xmpp-core')
const Roster = require('../models/roster')

function shouldHandle (stanza) {
  return stanza.is('presence') &&
    (!stanza.type || stanza.type === 'unavailable')
}

/* RFC6121 4. Exchanging Presence Information
 * https://xmpp.org/rfcs/rfc6121.html#presence
 */
module.exports = function (router) {
  const debug = require('debug')('traffic:mod:presence:inbound')
  return function presence (stanza, next) {
    if (shouldHandle(stanza)) {
      debug('broadcast %s %s', stanza.type || 'available', stanza)
      const to = new JID(stanza.to).bare().toString()
      router.route(to, stanza)
    } else {
      next()
    }
  }
}

/*******************************
/* C2S generated OUTBOUND packet
 */
module.exports.outbound = function (router) {
  const debug = require('debug')('traffic:mod:presence:outbound')
  return function presence (stanza, next) {
    var item
    if (!stanza.to && shouldHandle(stanza)) {
      debug('broadcast %s %s', stanza.type || 'available', stanza)
      // https://xmpp.org/rfcs/rfc6121.html#presence-initial-outbound
      const from = new JID(stanza.from).bare().toString()

      // TODO: first store presence stanza as-is as session presence
      // before we start modifying it for broadcast below
      // ...
      // server MUST send the initial presence stanza from the full JID
      // of the user to all contacts that are subscribed to the user's presence
      Roster.query({ User: { eq: from } }, (err, items) => {
        if (err) return next(err)
        for (item of items) {
          if (item.from) {
            stanza.to = item.jid
            stanza.send(stanza)
          }
        }
      })
      // server MUST also broadcast initial presence from the user's newly available resource
      // to all of the user's available resources
      stanza.to = from
      router.route(from, stanza)
    } else {
      next()
    }
  }
}
