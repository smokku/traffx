const { StanzaError } = require('junction')
const { JID, Presence } = require('node-xmpp-core')
const Roster = require('../models/roster')
const { rosterPush } = require('./roster')

// TODO
// - Implement Pending-In mechanics
// - If a remote contact does not approve or deny the subscription request within some configurable amount of time, the user's server SHOULD resend the subscription request to the contact based on an implementation-specific algorithm (e.g., whenever a new resource becomes available for the user, or after a certain amount of time has elapsed); this helps to recover from transient, silent errors that might have occurred when the original subscription request was routed to the remote domain. When doing so, it is RECOMMENDED for the server to include an 'id' attribute so that it can track responses to the resent subscription request.
//   (use 'ask' to store stanza?)
// - Implementation Note: If the user's account has no available resources when the inbound unsubscribed notification is received, the user's server MAY keep a record of the notification (ideally the complete presence stanza) and then deliver the notification when the account next has an available resource. This behavior provides more complete signaling to the user regarding the reasons for the roster change that occurred while the user was offline.
// - Implementation Note: If the contact's account has no available resources when the inbound unsubscribe notification is received, the contact's server MAY keep a record of the notification (ideally the complete presence stanza) and then deliver the notification when the account next has an available resource. This behavior provides more complete signaling to the user regarding the reasons for the roster change that occurred while the user was offline.
function shouldHandle (stanza) {
  return stanza.is('presence') &&
    [ 'subscribe', 'subscribed', 'unsubscribe', 'unsubscribed' ].includes(
      stanza.type
    )
}

function checkTo (stanza) {
  var to
  try {
    to = new JID(stanza.to)
  } catch (err) {
    return new StanzaError(err.message, 'modify', 'jid-malformed')
  }
  stanza.attr('to', to.bare().toString())
  return null
}

/* https://xmpp.org/rfcs/rfc6121.html#sub
 * presence subscription
 */
module.exports = function (router) {
  const debug = require('debug')('medium:mod:presence:inbound')
  return function presence (stanza, res, next) {
    if (shouldHandle(stanza)) {
      const err = checkTo(stanza)
      if (err) return next(err)

      const query = { User: { eq: stanza.to }, jid: { eq: stanza.from } }

      if (stanza.type === 'subscribe') {
        debug('%s %s', stanza.type, stanza)
        // https://xmpp.org/rfcs/rfc6121.html#sub-request-inbound
        Roster.query(query, (err, items) => {
          if (err) return next(err)
          const item = items[0]
          if (item) {
            // contact has (a) pre-approved subscription requests from the user as described under Section 3.4
            if (item.approved) {
              debug('already approved', item)
              // TODO
            }
            // 2. If the contact exists and the user already has a subscription to the contact's presence
            if (item.from) {
              debug('already subscribed', item)
              res.type = 'subscribed'
              res.send()
            }
          } else {
            // 3. if there is at least one available resource associated with the contact
            router.route(stanza.to, stanza)
            // TODO
            // 4. Otherwise, if the contact has no available resources when the subscription request
          }
        })
      } else if (stanza.type === 'subscribed') {
        debug('%s %s', stanza.type, stanza)
        // https://xmpp.org/rfcs/rfc6121.html#sub-request-approvalin
        Roster.query(query, (err, items) => {
          if (err) return next(err)
          const item = items[0]
          if (item) {
            // check if the contact is in the user's roster with subscription='none' or subscription='from' and the 'ask' flag set to "subscribe"
            if (!item.to && item.ask) {
              // 1. Deliver the inbound subscription approval to all of the user's interested resources
              router.route(stanza.to, stanza)
              // 2. Initiate a roster push
              Roster.update(
                { User: stanza.to, jid: stanza.from },
                { to: true, ask: null },
                (err, item) => {
                  if (err) return next(err)
                  if (item) {
                    debug('pushing', item)
                    router.route(stanza.to, rosterPush(stanza.to, item))
                  }
                }
              )
            }
          }
        })
      } else if (stanza.type === 'unsubscribe') {
        debug('%s %s', stanza.type, stanza)
        // https://xmpp.org/rfcs/rfc6121.html#sub-unsub-inbound
        Roster.query(query, (err, items) => {
          if (err) return next(err)
          const item = items[0]
          if (item) {
            // check if the user's bare JID is in the contact's roster with subscription='from' or subscription='both'
            if (item.from) {
              // 1. Deliver the inbound unsubscribe to all of the contact's interested resources
              router.route(stanza.to, stanza)
              // 2. Initiate a roster push
              Roster.update(
                { User: stanza.to, jid: stanza.from },
                { from: false },
                (err, item) => {
                  if (err) return next(err)
                  if (item) {
                    debug('pushing', item)
                    router.route(stanza.to, rosterPush(stanza.to, item))
                  }
                }
              )
              // 3. Generate an outbound presence stanza of type "unavailable" from each of the contact's available resources to the user.
              // FIXME!!! after implementing presence tracker
              router.log.error(
                { client_jid: stanza.to, roster_jid: stanza.from },
                'Should broadcast unavailable presence'
              )
            }
          }
        })
      } else if (stanza.type === 'unsubscribed') {
        debug('%s %s', stanza.type, stanza)
        // https://xmpp.org/rfcs/rfc6121.html#sub-cancel-inbound
        Roster.query(query, (err, items) => {
          if (err) return next(err)
          const item = items[0]
          if (item) {
            // check if the contact is in the user's roster with subscription='to' or subscription='both'
            if (item.to) {
              // 1. Deliver the inbound subscription cancellation to all of the user's interested resources
              router.route(stanza.to, stanza)
              // 2. Initiate a roster push
              Roster.update(
                { User: stanza.to, jid: stanza.from },
                { to: false },
                (err, item) => {
                  if (err) return next(err)
                  if (item) {
                    debug('pushing', item)
                    router.route(stanza.to, rosterPush(stanza.to, item))
                  }
                }
              )
            }
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
module.exports.outbound = function (c2s) {
  const debug = require('debug')('medium:mod:presence:outbound')
  return function presence (stanza, next) {
    if (shouldHandle(stanza)) {
      // https://xmpp.org/rfcs/rfc6120.html#stanzas-attributes-from-c2s
      var from = new JID(stanza.from).bare().toString()
      stanza.attr('from', from)

      const err = checkTo(stanza)
      if (err) return next(err)

      if (
        stanza.type === 'subscribe' ||
          stanza.type === 'subscribed' ||
          stanza.type === 'unsubscribe'
      ) {
        debug('%s %s', stanza.type, stanza)
        let change
        // https://xmpp.org/rfcs/rfc6121.html#sub-request-outbound
        if (stanza.type === 'subscribe') change = { ask: true }
        // https://xmpp.org/rfcs/rfc6121.html#sub-request-approvalout
        if (stanza.type === 'subscribed') change = { from: true }
        // https://xmpp.org/rfcs/rfc6121.html#sub-unsub-outbound
        if (stanza.type === 'unsubscribe') change = { to: false }

        // server MUST stamp [...] and locally deliver or remotely route the stanza
        next()

        // server then MUST send an updated roster push to all of the contact's interested resources
        Roster.update({ User: from, jid: stanza.to }, change, (err, item) => {
          if (err) return next(err)
          if (item) {
            debug('pushing', item)
            c2s.router.route(from, rosterPush(from, item))
          }
        })
        if (stanza.type === 'subscribed') {
          // server MUST then also send current presence to the user from each of the contact's available resources.
          // FIXME!!! after implementing presence tracker
          c2s.log.error(
            { client_jid: stanza.from, roster_jid: stanza.to },
            'Should broadcast current presence'
          )
        }
      } else if (stanza.type === 'unsubscribed') {
        const query = { User: { eq: stanza.from }, jid: { eq: stanza.to } }
        const update = { User: stanza.from, jid: stanza.to }
        // https://xmpp.org/rfcs/rfc6121.html#sub-cancel-outbound
        debug('%s %s', stanza.type, stanza)
        Roster.query(query, (err, items) => {
          if (err) return next(err)
          const item = items[0]
          if (item) {
            if (item.approved) {
              // 2. If [...]] the 'approved' flag is set to "true"
              Roster.update(update, { approved: null }, err => {
                if (err) {
                  c2s.log.error(
                    { client_jid: stanza.from, roster_jid: stanza.to, err },
                    'Failed removing approved state'
                  )
                }
              })
            }
            if (item.from) {
              // 3. the contact's server MUST route or deliver both presence notifications of type "unavailable"
              const unav = new Presence({
                type: 'unavailable',
                from: stanza.from,
                to: stanza.to
              })
              stanza.send(unav)
              // and presence stanzas of type "unsubscribed" to the user
              next()
              // and MUST send a roster push to the contact.
              Roster.update(update, { from: false }, (err, item) => {
                if (err) {
                  c2s.log.error(
                    { client_jid: stanza.from, roster_jid: stanza.to, err },
                    'Failed updating subscription state'
                  )
                } else {
                  debug('pushing', item)
                  c2s.router.route(stanza.from, rosterPush(stanza.from, item))
                }
              })
            }
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
