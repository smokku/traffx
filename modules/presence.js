const { StanzaError } = require('junction')
const { parse, JID, Presence } = require('node-xmpp-core')
const NS = require('../ns')
const Roster = require('../models/roster')
const Session = require('../models/session')
const Direct = require('../models/direct')
const Last = require('../models/last')

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
        Roster.one(stanza.to, stanza.from).then(item => {
          if (item && item.from) {
            Session.all(stanza.to).then(sessions => {
              if (
                sessions &&
                  (sessions = Object
                    .keys(sessions)
                    .map(resource => sessions[resource])).length >
                    0
              ) {
                // 4. if the contact has at least one available resource, then the server MUST reply to the presence probe
                //    by sending to the user the full XML of the last presence stanza with no 'to' attribute received
                //    by the server from each of the contact's available resources
                for (const session of sessions) {
                  const presence = parse(session)
                  presence.to = stanza.from
                  stanza.send(presence)
                }
              } else {
                Last.get(stanza.to).then(last => {
                  // presence notification MAY include the full XML of the last unavailable presence stanza
                  // that the server received from the contact (including the 'id' of the original stanza)
                  if (last) {
                    const presence = parse(last.presence)
                    resp.id = presence.id
                    resp.children = presence.children
                    // SHOULD include information about the time when the last unavailable presence stanza was generated
                    // (formatted using the XMPP delayed delivery extension)
                    const delay = resp.getChild('delay', NS.DELAY) || resp.c('delay', NS.DELAY)
                    delay.attr('from', stanza.to)
                    delay.attr('stamp', last.date.toISOString())
                  }
                  // 3. if the contact has no available resources, then the server SHOULD reply to the presence probe
                  //    by sending to the user a presence stanza of type "unavailable"
                  resp.type = 'unavailable'
                  resp.send()
                }).catch(next)
              }
            }).catch(next)
          } else {
            // 1. If the contact account does not exist or the user's bare JID is in the contact's roster with
            //    a subscription state other than "From", "From + Pending Out", or "Both", then the contact's server
            //    SHOULD return a presence stanza of type "unsubscribed"
            resp.type = 'unsubscribed'
            resp.send()
          }
        }).catch(next)
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
      if (isBroadcast(stanza)) {
        debug(
          '%s %s %s',
          stanza.to ? 'direct' : 'broadcast',
          stanza.type || 'available',
          stanza
        )
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
        if (!stanza.to) {
          if (!stanza.type) {
            stanza.client.session = true
            Session.set(from, resource, priority, stanza).catch(next)
          } else {
            stanza.client.session = false
            Session.del(from, resource, stanza).catch(next)
            Last.set(from, stanza, new Date())
          }

          // server MUST send the initial presence stanza from the full JID
          // of the user to all contacts that are subscribed to the user's presence
          Roster.all(from).then(items => {
            var item
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
          }).catch(next)
          // server MUST also broadcast initial presence from the user's newly available resource
          // to all of the user's available resources
          stanza.to = from
          router.route(from, stanza)
          // https://xmpp.org/rfcs/rfc6121.html#presence-directed-considerations
          // clearing the list when the user goes offline (e.g., by sending a broadcast presence stanza of type "unavailable")
          if (stanza.type) {
            Direct.clear(stanza.from).catch(next)
          }
        } else {
          // https://xmpp.org/rfcs/rfc6121.html#presence-directed-gen
          if (!stanza.type) {
            Direct.set(stanza.from, stanza.to)
          } else {
            // https://xmpp.org/rfcs/rfc6121.html#presence-directed-considerations
            // server MUST remove from the directed presence list any entity to which the user sends directed unavailable presence
            Direct.del(stanza.from, stanza.to)
          }
          // server MUST locally deliver or remotely route the full XML of that presence stanza
          next()
        }
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

/*******************************
/* C2S delivered packet
 */
module.exports.deliver = function (router) {
  const debug = require('debug')('traffic:mod:presence:dispatch')
  return function presence (stanza, resp, next) {
    if (stanza.is('presence') && stanza.type === 'probe') {
      debug('probe %s', stanza)
      // https://xmpp.org/rfcs/rfc6121.html#presence-directed-probe
      Direct.one(stanza.to, stanza.from).then(direct => {
        resp.type = direct ? undefined : 'unavailable'
        resp.send()
      }).catch(next)
    } else {
      next()
    }
  }
}
