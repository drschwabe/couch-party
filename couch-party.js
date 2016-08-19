var PouchDB = require('pouchdb'),
    _pouch = require('underpouch'),
    _ = require('underscore'), 
    bcrypt = require('bcrypt'),
    _s = require('underscore.string')

var couchParty = {}

couchParty.login = function(baseURL, login, callback) {
  //^ string, object, function
  //baseURL parameter should have format like: "http://admin:admin@localhost:5984/myproject" 
  //Find the id which corresponds to the nickname...
  var dbUsers = new PouchDB(baseURL + '_users')
  //^ "_users" part appended automatically, 
  //which results in a db name of ie: "myproject_users"
  _pouch.find(dbUsers, function(doc) { return doc.nickname == login.nickOrEmail || doc.email == login.nickOrEmail || doc.email == login.email || doc.nickname == login.nickname }, function(doc) {

    //If user does not exist:
    if(_.isUndefined(doc)) return callback('No user with that nickname or email.')

    //Password check:
    bcrypt.compare(login.password, doc.password, function(err, res) {
      if(err) return console.log(err)
      if(!res) return callback('Incorrect password.')

      //Now connect to the corresponding (existing) database
      //which is based on the user's couch generated hash (but in lower case)
      var userDb = new PouchDB(baseURL + '_user_' + doc._id.toLowerCase())

      userDb.get('user', function(err, userDoc) {
        if(err) return callback(err)
        //Merge in the email and nickname from the previous doc:
        userDoc = _.extend(doc, userDoc)
        callback(null, userDoc)
      })
    })
  })
}

couchParty.register = function(baseURL, login, callback) {
  var dbUsers = new PouchDB(baseURL + '_users')

  //Check for existing user based on email address: 
  _pouch.find(dbUsers, function(doc) { return doc.email == login.email }, function(doc) {
    //If user exists:
    if(doc) {
      return callback('A user with that email already exists.')
    } else {
      //Creates a doc in the "baseName_users" database:
      doc = login
      doc.verified = false
      doc.created = Math.floor(Date.now() / 1000) //< Unix timestamp in seconds.

      //Apply a secret token: 
      doc.signup_token = require('crypto').randomBytes(64).toString('hex')

      //Encrypt the password: 
      bcrypt.hash(doc.password, 10, function(err, hash) {
        if(err) return console.log(err)
        doc.password = hash
        dbUsers.post(doc, function(err, res) {
          if(err) return console.log(err)
          console.log(res)
          //Now create a unique database for the user:
          var userDbName = baseURL.split("/").pop() + '_user_' + res.id

          console.log('### userDbName ###')
          console.log(userDbName)

          console.log('### userDb address ###')
          console.log(_s.strLeftBack(baseURL, '/') + '/' + userDbName)          

          //^^ strip out the address. 
          var userDb = new PouchDB(_s.strLeftBack(baseURL, '/') + '/' + userDbName)
          //Make a single 'user' doc with reference to id and new database:
          userDoc = {
            _id : 'user', 
            db_id : res.id, 
            db_name : userDbName
          }
          userDb.put(userDoc, function(err, res) {
            if(err) return console.log(err)
            console.log(res)
            callback(null, doc.signup_token)
          })
        })      
      })
    }
  })
}

couchParty.verify = function(baseURL, signupToken, callback) {
  console.log('verify user...')
  var dbUsers = new PouchDB(baseURL + '_users')
  _pouch.find(dbUsers, function(doc) { return doc.signup_token == signupToken }, function(doc) {
    if(!doc) return callback('The token is invalid or expired.')    
    doc.verified = true
    delete doc._rev //< Remove this so we can update the doc in the user db.
    var userDb = new PouchDB(baseURL + '_user_' + doc._id.toLowerCase())
    doc._id = 'user' //< Change id to just 'user' to fit the user db doc's model.    
    userDb.get('user', function(err, originalDoc) {
      if(err) return callback(err)
      doc = _.extend(doc, originalDoc)
      //Delete the signup_token: 
      delete doc.signup_token
      userDb.put(doc, function(err, res) {
        if(err) {
          console.log(err)
          return callback(err)
        }
        doc._rev = res.rev
        //Do a one time sync: 
        couchParty.syncSomeone(baseURL, doc.db_id)        
        if(callback) return callback(null, doc)        
      })        
    })
  })  
}

couchParty.syncEverybody = function(baseURL) {
  //### User database changes ###
  //Listen for changes to the user's databases.
  //(if password or email change happened in user's database,
  //this needs to be applied to master users db (baseName_users))
  var dbUsers = new PouchDB(baseURL + '_users')
  _pouch.all(dbUsers, function(userDocs) {
    if(!_.isArray(userDocs)) userDocs = [userDocs]
    userDocs.forEach(function(userDoc) {
      //Create a new changes feed...
      var userDb = new PouchDB(baseURL + '_user_' + userDoc._id.toLowerCase())
      userDb.changes({live:true, include_docs: true, doc_ids: ['user']})
        .on('change', function(change) {
          console.log('Change to be applied for ' + userDoc.email)
          console.log(change.doc)
          console.log('-------------------')
          //Throw away the id and rev:
          delete change.doc._id
          delete change.doc._rev
          //Apply any relevant changes; overwrite the existing userDoc:
          var updatedDoc = _.extend(userDoc, change.doc)
          //Put in the master users db:
          dbUsers.put(updatedDoc, function(err, res) {
            if(err) return console.log(err)
            console.log(res)
            //Update the rev so this process works again next change:
            userDoc._rev = res.rev
          })
        })
        .on('error', function (err) {
          console.log(err)
        })
    })
  })
}

var partiers = []

//Just sync this one person
//TODO: Stop syncing after 90 minutes or specified duration.
couchParty.syncSomeone = function(baseURL, userId, live) {
  if(_.isNull(live)) live = false
  if( _.contains(partiers, userId)) {
    console.log('Already syncing ' + userId)
    return
  }
  console.log('Sync user: ' + userId)
  if(!live) console.log('(one shot sync)')
  else console.log('(live; persistent sync)')
  
  if(live) partiers.push(userId)

  var dbUsers = new PouchDB(baseURL + '_users')  
  var userDb = new PouchDB(baseURL + '_user_' + userId)
  var changes = userDb.changes({live: live, include_docs: true, doc_ids: ['user']})
    .on('change', function(change) {
      console.log('Change to be applied for ' + userId)
      console.log(change.doc)
      console.log('-------------------')

      //Throw away the id and rev...
      delete change.doc._id
      //Put in the master users db:
      _pouch.extend(dbUsers, userId, change.doc, function(updatedDoc) {
        console.log('Change applied successfully.')
      })
    })
    .on('error', function (err) {
      console.log(err)
    })
    .on('complete', function(info) {
      console.log(userId + ' has left the party (no longer syncing).')
      console.log(info)
    })

  //Cancel the changes listening / assume user has left the party after x minutes.
  setTimeout(function() {
    changes.cancel()
    partiers = _.without(partiers, userId)
  }, 1800000) //< 30 minutes. 
}

//TODO: make an alias for "resetLink"
couchParty.resetToken = function(baseURL, email, callback) {
  var secretToken = require('crypto').randomBytes(64).toString('hex')
  var dbUsers = new PouchDB(baseURL + '_users')
  _pouch.find(dbUsers, function(doc) { return doc.email == email }, function(doc) {
    if(_.isUndefined(doc)) return callback('No user with that email exists.')
    //Apply the token to the user's db...
    doc.secret_token = secretToken
    //Get the userDb: 
    var userDb = new PouchDB(baseURL + '_user_' + doc._id.toLowerCase())
    //Remove the doc id so _pouch.extend works: 
    delete doc._id
    //Extend the userDb's "user" doc with the new token:  
    _pouch.extend(userDb, 'user', doc, function(doc) {
      //make sure the change is synced: 
      couchParty.syncSomeone(baseURL, doc.db_id)      
      //and now send the token back: 
      callback(null, secretToken)       
    })
  })
}

couchParty.resetPass = function(baseURL, secretToken, newPass, callback) {          
  var dbUsers = new PouchDB(baseURL + '_users')  
  _pouch.find(dbUsers, function(doc) { return doc.secret_token == secretToken }, function(userDoc) {
    if(!userDoc) return callback('The reset token is invalid or expired.')
    bcrypt.hash(newPass, 10, function(err, hash) {
      if(err) return console.log(err)
      userDoc.password = hash
      var userDb = new PouchDB(baseURL + '_user_' + userDoc._id) 
      delete userDoc.secret_token
      delete userDoc._id
      _pouch.extend(userDb, 'user', userDoc, function(resultingDoc) {
        couchParty.syncSomeone(baseURL, userDoc.db_id)
        callback(null)
      })
    })    
  })
}

couchParty.updatePass = function(baseURL, email, newPass, callback) {
  var dbUsers = new PouchDB(baseURL + '_users') 
  _pouch.findWhere(dbUsers, { email : email }, function(userDoc) {
    //Encrypt the newpass: 
    bcrypt.hash(newPass, 10, function(err, hash) {
      if(err) return console.log(err)
      userDoc.password = hash

      var userDb = new PouchDB(baseURL + '_user_' + userDoc._id.toLowerCase())

      delete userDoc._id //< Delete this so we can do _pouch.extend

      //We apply the change to the userDb which will
      //replicate back to dbUsers via couchParty.syncSomone or couchParty.SyncEverybody
      _pouch.extend(userDb, 'user', userDoc, function(updatedUserDoc) {
        callback(null)
      })    
    })    
  })
}

//Delete a user: 
couchParty.remove = function(baseURL, email, callback) {
  var dbUsers = new PouchDB(baseURL + '_users') 
  _pouch.findWhere(dbUsers, { email : email }, function(userDoc) {
    dbUsers.remove(userDoc, function(err, res) {
      if(err) return callback(err)
      var userDb = new PouchDB(baseURL + '_user_' + userDoc._id)
      userDb.destroy(function(err, res) {
        if(err) return callback(err)
        callback(null)            
      })
    })
  })
}

//Check if email is already in use: 
couchParty.isEmailAvail = function(baseURL, email, callback) {
  var dbUsers = new PouchDB(baseURL + '_users')
  _pouch.findWhere(dbUsers, { email: email }, function(doc) {
    if(doc) return callback(false) 
    else return callback(true)
  })
}

module.exports = couchParty
