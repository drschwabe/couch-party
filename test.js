var test = require('tape'),
    requireUncached = require('require-uncached')

// ### Start Tests ###

test.onFinish(() => {
  console.log(`### Tests complete, test server should now be exited manually ###`)
  process.exit() 
}) 

var baseDbURL = 'http://localhost:5988/party'

test('Can register a user', (t) => {
  t.plan(5)
  var couchParty = requireUncached('./couch-party.js')

  let registrant = {
    nickname : 'Sarah',
    email : 'sara@geemail.com',
    password : 'w00t'
  }

  couchParty.register(baseDbURL, registrant, (err, res) => {
    if(err) return t.fail(err)
    console.log(res)
    t.ok(res.user_doc, 'couchParty response has a user_doc')
    t.equals(res.user_doc._id, 'user', 'couchParty user_doc has { _id : "user" }')
    t.ok(res.user_doc.db_id, 'couchParty user_doc has a db_id')
    t.ok(res.user_doc.db_name, 'couchParty user_doc has a db_name')
    //TODO: ensure db_name is prefixed with party_
    t.ok(res.signup_token, 'couchParty response has a signup_token')

    //TODO: query the db and ensure this info is in there:
    //t.equals(res.email, 'sara@geemail.com')
    //t.equals(res.password, 'w00t')
    //and that user is not confirmed/verified yet.
  })
})


test('Username already taken', (t) => {
  //TODO: make this test.only-able
  //(currently relies on prior test)
  t.plan(1)
  var couchParty = requireUncached('./couch-party.js')

  let registrant = {
    nickname : 'Sarah',
    email : 'sara@geemail.com',
    password : 'w00t'
  }

  couchParty.register(baseDbURL, registrant, (err, res) => {
    if(!err) return t.fail('no err was provided, but that username should be taken')
    t.equals(err, 'That nickname is already taken.', 'Duplicate username registration rejected with relevant error.')
  })

})

test('Email already in use', (t) => {
  t.plan(1)
  var couchParty = requireUncached('./couch-party.js')

  let originalRegistrant = {
    email : 'steve@geemail.com',
    password : 'jumparound'
  }

  couchParty.register(baseDbURL, originalRegistrant, (err, res) => {
    if(err) return t.fail(err)

    let registrantAgainWithSameEmailDiffPass = {
      email : 'steve@geemail.com',
      password : 'jumparoundagain'
    }

    couchParty.register(baseDbURL, registrantAgainWithSameEmailDiffPass, (err, res) => {
      if(!err) return t.fail('no err was provided, but that email should be taken')
      t.equals(err, 'A user with that email already exists.', 'Duplicate email registration rejected with relevant error.')
    })

  })
})

test('Can verify a user', (t) => {
  t.plan(1)
  var couchParty = requireUncached('./couch-party.js')

  let registrant = {
    email : 'jeff@geemail.com',
    password : 'dinosaurssuck'
  }

  couchParty.register(baseDbURL, registrant, (err, res) => {
    if(err) return t.fail(err)

    couchParty.verify(baseDbURL, res.signup_token, (err, res) => {
      if(err) return t.fail(err)
      console.log(res)
      couchParty.cancel() //Cancel any replication to avoid errors closing.
      t.pass('User verified ok')
      t.end()
    })
  })
})

test.skip('Cannot login if not verified', (t) => {
  t.plan(1)
  const couchParty = requireUncached('./couch-party.js')

  let registrant = {
    email : 'bob@geemail.com',
    password : 'spaceislame'
  }

  couchParty.register(baseDbURL, registrant, (err, res) => {
    if(err) return t.fail(err)

    //the registrant object (containing email and password key value pairs) supplied for login is same as what was used as during registration:

    couchParty.login(baseDbURL, registrant, (err, res) => {
        if(err) {
          console.log(err)
          //error should be 'not verified'
          return t.equals(err, 'Account is not verified.', 'Error about not verified returned')
        } //below should not run:
        console.log(res)
        t.fail('no err was provided')
    })

  })

})