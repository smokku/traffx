const { StanzaError } = require('junction')
const { parse, JID, Presence } = require('node-xmpp-core')
const Roster = require('../models/roster')
const Session = require('../models/session')

function isBroadcast (stanza) {
  return !stanza.type ||
    stanza.type === 'unavailable' ||
    stanza.type === 'error'
}

/* RFC6121 4. Exchanging Presence Information
 * https://xmpp.org/rfcs/rfc6121.html#presence
 */
module.exports = function (router) {
  const debug = require('debug')('traffic:mod:presence:inbound')
  return function presence (stanza, resp, next) {
    if (stanza.is('presence')) {
      if (isBroadcast(stanza)) {
        debug('broadcast %s %s', stanza.type || 'available', stanza)
        // https://xmpp.org/rfcs/rfc6121.html#presence-initial-inbound
        const to = new JID(stanza.to).bare().toString()
        router.route(to, stanza)
      } else if (stanza.type === 'probe') {
        debug('probe %s', stanza)
        // https://xmpp.org/rfcs/rfc6121.html#presence-probe-inbound-id
        resp.id = stanza.id
        // https://xmpp.org/rfcs/rfc6121.html#presence-probe-inbound
        const query = { User: { eq: stanza.to }, jid: { eq: stanza.from } }
        Roster.query(query, (err, items) => {
          if (err) return next(err)
          const item = items[0]
          if (item && item.from) {
            Session.all(stanza.to).then(sessions => {
              sessions = Object
                .keys(sessions)
                .map(resource => sessions[resource])
              if (sessions.length > 0) {
                // 4. if the contact has at least one available resource, then the server MUST reply to the presence probe
                //    by sending to the user the full XML of the last presence stanza with no 'to' attribute received
                //    by the server from each of the contact's available resources
                for (const session of sessions) {
                  const presence = parse(session)
                  presence.to = stanza.from
                  stanza.send(presence)
                }
              } else {
                // 3. if the contact has no available resources, then the server SHOULD reply to the presence probe
                //    by sending to the user a presence stanza of type "unavailable"
                resp.type = 'unavailable'
                // TODO SHOULD include information about the time when the last unavailable presence stanza was generated
                // (formatted using the XMPP delayed delivery extension)
                resp.send()
                // TODO presence notification MAY include the full XML of the last unavailable presence stanza
                // that the server received from the contact (including the 'id' of the original stanza)
              }
            }).catch(next)
          } else {
            // 1. If the contact account does not exist or the user's bare JID is in the contact's roster with
            //    a subscription state other than "From", "From + Pending Out", or "Both", then the contact's server
            //    SHOULD return a presence stanza of type "unsubscribed"
            resp.type = 'unsubscribed'
            resp.send()
          }
        })
      } else {
        next()
      }
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
    if (stanza.is('presence')) {
      const session = stanza.client.session
      if (!stanza.to && isBroadcast(stanza)) {
        debug('broadcast %s %s', stanza.type || 'available', stanza)
        // https://xmpp.org/rfcs/rfc6121.html#presence-initial-outbound
        const from = new JID(stanza.from).bare().toString()
        // https://xmpp.org/rfcs/rfc6121.html#presence-probe-outbound
        const probe = !session ? new Presence({ type: 'probe', from }) : null

        // first store presence stanza as-is as session presence
        // before we start modifying it for broadcast below
        const resource = new JID(stanza.from).resource
        const priorityElement = stanza.getChild('priority')
        const priority = priorityElement
          ? parseFloat(priorityElement.getText())
          : 0
        // https://xmpp.org/rfcs/rfc6121.html#presence-syntax-children-priority
        if (
          Number.isNaN(priority) ||
            priority < -128 ||
            priority > 127 ||
            priority !== Math.floor(priority)
        ) {
          return next(new StanzaError(
            'Invalid presence priority',
            'modify',
            'bad-request'
          ))
        }
        if (!stanza.type) {
          Session.set(from, resource, priority, stanza).catch(next)
        } else {
          Session.del(from, resource, stanza).catch(next)
        }

        // server MUST send the initial presence stanza from the full JID
        // of the user to all contacts that are subscribed to the user's presence
        Roster.query({ User: { eq: from } }, (err, items) => {
          var item
          if (err) return next(err)
          for (item of items) {
            if (item.from) {
              stanza.to = item.jid
              stanza.send(stanza)
            }
            if (item.to && probe) {
              probe.to = item.jid
              stanza.send(probe)
            }
          }
        })
        // server MUST also broadcast initial presence from the user's newly available resource
        // to all of the user's available resources
        stanza.to = from
        router.route(from, stanza)
      } else {
        // https://xmpp.org/rfcs/rfc6121.html#presence-syntax-type
        // If the value of the 'type' attribute is not one of the foregoing values, the recipient
        // or an intermediate router SHOULD return a stanza error of <bad-request/>
        if (
          [
            undefined,
            'error',
            'probe',
            'subscribe',
            'subscribed',
            'unavailable',
            'unsubscribe',
            'unsubscribed'
          ].includes(stanza.type)
        ) {
          next()
        } else {
          return next(new StanzaError(
            'Invalid presence type: ' + stanza.type,
            'modify',
            'bad-request'
          ))
        }
      }
    } else {
      next()
    }
  }
}
