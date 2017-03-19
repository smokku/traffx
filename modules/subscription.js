const { StanzaError } = require('junction')
const { parse, JID } = require('node-xmpp-core')
const Roster = require('../models/roster')
const { rosterPush, isDummy } = require('./roster')

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

/* RFC6121 3. Managing Presence Subscriptions
 * https://xmpp.org/rfcs/rfc6121.html#sub
 */
module.exports = function (router) {
  const debug = require('debug')('traffic:mod:subscription:inbound')
  return function subscription (stanza, res, next) {
    if (shouldHandle(stanza)) {
      const err = checkTo(stanza)
      if (err) return next(err)

      debug('%s %s', stanza.type, stanza)

      if (stanza.type === 'subscribe') {
        // https://xmpp.org/rfcs/rfc6121.html#sub-request-inbound
        Roster.one(stanza.to, stanza.from).then(item => {
          if (item && item.from) {
            // 2. If the contact exists and the user already has a subscription to the contact's presence
            debug('already subscribed', item)
            res.type = 'subscribed'
            res.send()
          } else {
            if (item && item.approved) {
              // https://xmpp.org/rfcs/rfc6121.html#sub-preapproval-proc
              debug('already approved', item)
              res.type = 'subscribed'
              res.send()
              Roster.set(stanza.to, stanza.from, { from: true }).then(item => {
                router.route(stanza.to, rosterPush(stanza.to, item))
              }).catch(next)
            } else {
              // 3. if there is at least one available resource associated with the contact
              router.route(stanza.to, stanza)
              // 4. Otherwise, if the contact has no available resources when the subscription request
              Roster
                .set(stanza.to, stanza.from, { in: stanza.toString() })
                .catch(next)
              // keep a record of the complete presence stanza comprising the subscription request, including any extended content contained therein
              // and then deliver the request when the contact next has an available resource
              // server SHOULD store only one of those requests, such as the first request or last request, and MUST deliver only one of the requests when the contact next has an available resource
            }
          }
        }).catch(next)
      } else if (stanza.type === 'subscribed') {
        // https://xmpp.org/rfcs/rfc6121.html#sub-request-approvalin
        Roster.one(stanza.to, stanza.from).then(item => {
          if (item) {
            // check if the contact is in the user's roster with subscription='none' or subscription='from' and the 'ask' flag set to "subscribe"
            if (!item.to && item.ask) {
              // 1. Deliver the inbound subscription approval to all of the user's interested resources
              router.route(stanza.to, stanza)
              // 2. Initiate a roster push
              Roster
                .set(stanza.to, stanza.from, { to: true, ask: null })
                .then(item => {
                  router.route(stanza.to, rosterPush(stanza.to, item))
                })
                .catch(next)
            }
          }
        }).catch(next)
      } else if (stanza.type === 'unsubscribe') {
        // https://xmpp.org/rfcs/rfc6121.html#sub-unsub-inbound
        Roster.one(stanza.to, stanza.from).then(item => {
          if (item) {
            // check if the user's bare JID is in the contact's roster with subscription='from' or subscription='both'
            if (item.from) {
              // 1. Deliver the inbound unsubscribe to all of the contact's interested resources
              router.route(stanza.to, stanza)
              // 2. Initiate a roster push
              Roster.set(stanza.to, stanza.from, { from: false }).then(item => {
                router.route(stanza.to, rosterPush(stanza.to, item))
              }).catch(next)
              // 3. Generate an outbound presence stanza of type "unavailable" from each of the contact's available resources to the user.
              // FIXME!!! after implementing presence tracker
              router.log.error(
                { client_jid: stanza.to, roster_jid: stanza.from },
                'Should broadcast unavailable presence'
              )
            }
            // if the contact's server is keeping track of an inbound presence subscription request from the user to the contact
            // but the user is not yet in the contact's roster, then the contact's server MUST simply remove any record of the inbound
            // presence subscription request (it cannot remove the user from the contact's roster because the user was never added to the contact's roster).
            if (isDummy(item)) {
              Roster.del(stanza.to, stanza.from).catch(next)
            } else {
              Roster.set(stanza.to, stanza.from, { in: null }).catch(next)
            }
          }
        }).catch(next)
      } else if (stanza.type === 'unsubscribed') {
        // https://xmpp.org/rfcs/rfc6121.html#sub-cancel-inbound
        Roster.one(stanza.to, stanza.from).then(item => {
          if (item) {
            // check if the contact is in the user's roster with subscription='to' or subscription='both'
            // A.3.4. Unsubscribed table
            // https://tools.ietf.org/html/rfc3921#section-8.2.1 3. Upon receiving the presence stanza of type "unsubscribed"
            //   addressed to the user, the user's server (1) MUST deliver that presence stanza to the user
            if (item.to || item.ask) {
              // 1. Deliver the inbound subscription cancellation to all of the user's interested resources
              router.route(stanza.to, stanza)
              // 2. Initiate a roster push
              Roster.set(stanza.to, stanza.from, { to: false, ask: null }).then(item => {
                router.route(stanza.to, rosterPush(stanza.to, item))
              }).catch(next)
            }
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
  const debug = require('debug')('traffic:mod:subscription:outbound')
  return function subscription (stanza, next) {
    if (shouldHandle(stanza)) {
      // https://xmpp.org/rfcs/rfc6120.html#stanzas-attributes-from-c2s
      stanza.attr('from', new JID(stanza.from).bare().toString())

      const err = checkTo(stanza)
      if (err) return next(err)

      debug('%s %s', stanza.type, stanza)

      Roster.one(stanza.from, stanza.to).then(item => {
        if (
          stanza.type === 'subscribe' ||
            stanza.type === 'unsubscribe' ||
            stanza.type === 'subscribed'
        ) {
          let change
          // https://xmpp.org/rfcs/rfc6121.html#sub-request-outbound
          if (stanza.type === 'subscribe') change = { ask: stanza.toString() }
          // https://xmpp.org/rfcs/rfc6121.html#sub-unsub-outbound
          if (stanza.type === 'unsubscribe') change = { to: false, ask: null }
          // https://xmpp.org/rfcs/rfc6121.html#sub-request-approvalout
          if (stanza.type === 'subscribed') {
            // https://xmpp.org/rfcs/rfc6121.html#sub-preapproval-proc
            // 1. If the contact is in the user's roster with a state of "Both", "From", or "From + Pending Out",
            //    the user's server MUST silently ignore the stanza.
            if (item && item.from) return

            if (!item || !item.in) {
              // 4. If the contact is not yet in the user's roster, the user's server MUST create a roster item for the contact
              //    with a state of "None" and set the 'approved' flag to a value of "true",
              // 3. If the contact is in the user's roster with a state of "To", "None", or "None + Pending Out",
              //    the user's server MUST note the subscription pre-approval by setting the 'approved' flag to a value of "true",
              //    then push the modified roster item to all of the user's interested resources.
              Roster.set(stanza.from, stanza.to, { approved: true }).then(item => {
                // then push the roster item to all of the user's interested resources.
                router.route(stanza.from, rosterPush(stanza.from, item))
              }).catch(next)
              // However, the user's server MUST NOT route the presence stanza of type "subscribed" to the contact.
              return
            } else {
              // 2. If the contact is in the user's roster with a state of "To + Pending In", "None + Pending In",
              //    or "None + Pending Out+In", the user's server MUST handle the stanza as a normal subscription approval
              change = { from: true }
            }
          }

          // server MUST stamp [...] and locally deliver or remotely route the stanza
          next()

          // server then MUST send an updated roster push to all of the contact's interested resources
          Roster.set(stanza.from, stanza.to, change).then(item => {
            router.route(stanza.from, rosterPush(stanza.from, item))
          }).catch(next)

          if (stanza.type === 'subscribed') {
            // server MUST then also send current presence to the user from each of the contact's available resources.
            // FIXME!!! after implementing presence tracker
            router.log.error(
              { client_jid: stanza.from, roster_jid: stanza.to },
              'Should broadcast current presence'
            )
          }
        } else if (stanza.type === 'unsubscribed') {
          // https://xmpp.org/rfcs/rfc6121.html#sub-cancel-outbound
          if (item) {
            const change = {}
            let push = false
            if (item.in) {
              change.in = null
            }
            if (item.approved) {
              // 2. If [...]] the 'approved' flag is set to "true"
              // remove the pre-approval and MUST NOT route or deliver the presence stanza of type "unsubscribed" to the user
              change.approved = null
              push = true
            }
            if (item.from) {
              // 3. the contact's server MUST route or deliver both presence notifications of type "unavailable"
              // FIXME!!! after implementing presence tracker
              // While the user is still subscribed to the contact's presence (i.e., before the contact's server routes or delivers the presence stanza of type "unsubscribed" to the user), the contact's server MUST send a presence stanza of type "unavailable" from all of the contact's online resources to the user.
              router.log.error(
                { client_jid: stanza.from, roster_jid: stanza.to },
                'Should send unavailable presences'
              )
              // and presence stanzas of type "unsubscribed" to the user
              next()
              // and MUST send a roster push to the contact.
              change.from = false
              push = true
            } else if (item.in) {
              // https://tools.ietf.org/html/rfc3921#section-8.2.1
              // 2. As a result, the contact's server MUST route the presence stanza of type "unsubscribed" to the user
              next()
            }
            Roster.set(stanza.from, stanza.to, change).then(item => {
              if (push) {
                router.route(stanza.from, rosterPush(stanza.from, item))
              }
            }).catch(next)
          }
        } else {
          next()
        }
      }).catch(next)
    } else if (stanza.is('presence') && stanza.type !== 'unavailable') {
      const from = new JID(stanza.from).bare().toString()
      if (!stanza.to || stanza.to === from) {
        debug('presence broadcast triggering')
        Roster.all(from).then(items => {
          for (var item of items) {
            // 3.1.3.  Server Processing of Inbound Subscription Request
            // then deliver the request when the contact next has an available resource.
            // The contact's server MUST continue to deliver the subscription request whenever
            // the contact creates an available resource, until the contact either approves or denies the request
            if (item.in) {
              stanza.send(parse(item.in))
            }
            // 3.1.2.  Server Processing of Outbound Subscription Request
            // If a remote contact does not approve or deny the subscription request within some configurable amount of time,
            // the user's server SHOULD resend the subscription request to the contact based on an implementation-specific algorithm
            // (e.g., whenever a new resource becomes available for the user, or after a certain amount of time has elapsed);
            if (item.ask) {
              stanza.send(parse(item.ask))
            }
          }
        }).catch(next)
        next()
      } else {
        next()
      }
    } else {
      next()
    }
  }
}

module.exports.streamFeatures = { sub: 'urn:xmpp:features:pre-approval' }
