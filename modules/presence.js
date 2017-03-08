const { StanzaError } = require('junction')
const { JID } = require('node-xmpp-core')
const Roster = require('../models/roster')
const { rosterPush } = require('./roster')

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
        debug('subscribe %s', stanza)
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
        debug('subscribed %s', stanza)
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
                  next()
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

module.exports.outbound = function (c2s) {
  const debug = require('debug')('medium:mod:presence:outbound')
  return function presence (stanza, next) {
    if (shouldHandle(stanza)) {
      // https://xmpp.org/rfcs/rfc6120.html#stanzas-attributes-from-c2s
      var from = new JID(stanza.from).bare().toString()
      stanza.attr('from', from)

      const err = checkTo(stanza)
      if (err) return next(err)

      if (stanza.type === 'subscribe' || stanza.type === 'subscribed') {
        debug('%s %s', stanza.type, stanza)
        let change
        // https://xmpp.org/rfcs/rfc6121.html#sub-request-outbound
        if (stanza.type === 'subscribe') change = { ask: true }
        // https://xmpp.org/rfcs/rfc6121.html#sub-request-approvalout
        if (stanza.type === 'subscribed') change = { from: true }

        Roster.update({ User: from, jid: stanza.to }, change, (err, item) => {
          if (err) return next(err)
          if (item) {
            debug('pushing', item)
            c2s.router.route(from, rosterPush(from, item))
          }
          next()
        })
      } else {
        next()
      }
    } else {
      next()
    }
  }
}
