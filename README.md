# Development

The main tool used to run code of the server during development are tests.
Assuming the test you are focusing on is in test/foo.js, enable this test only
by editing the file as so:

    test.only.cb('foo test', t => ...

and run this specific file:

    env DUMP_EXCEPTIONS=1 DEBUG="traffic:*,xmpp:*,junction" ./node_modules/.bin/ava --timeout=5s --watch -v test/foo.js

This will continously run your test and re-run every file modification.

`DUMP_EXCEPTIONS` causes Errors thrown and/or returned as packet errors to be
dumped with stack trace on the console.
`DEBUG` enables specific debug categories.

After finishing your changes, remove `.only` from your test and run all tests
with:

    npm test

