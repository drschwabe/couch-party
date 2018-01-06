var PouchDB = require('pouchdb'),
    _pouch = require('underpouch'),
    _ = require('underscore'), 
    bcrypt = require('bcrypt'),
    _s = require('underscore.string')

var couchParty = {}

couchParty.login = function(baseURL, login, callback) {
  //^ string, object, function
  //baseURL parameter should have format like: "http://admin:admin@localhost:5984/myproject" 

  //Connect to master users database: 
  var dbUsers = new PouchDB(baseURL + '_users')
  //^ "_users" part appended automatically, 
  //which results in a db name of ie: "myproject_users"

  //Parse the login object and standardize it: 
  const standardLogin = {}
  if(login.email) standardLogin.nickOrEmail = login.email 
  else if (login.nickOrEmail) standardLogin.nickOrEmail = login.nickOrEmail
  else if(login.nickname) standardLogin.nickOrEmail = login.nickname
  else return callback('Login object missing required nickname or email.')

  //Find the user who matches:
  _pouch.find(dbUsers, function(doc) { return doc.nickname == standardLogin.nickOrEmail || doc.email == standardLogin.nickOrEmail }, function(doc) {

    //If user does not exist:
    if(_.isUndefined(doc)) return callback('No user with that nickname or email (' + doc.nickname == standardLogin.nickOrEmail || doc.email == standardLogin.nickOrEmail + ')')

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
  _pouch.find(dbUsers, function(doc) { 
    if(doc.email === login.email) return doc
    if(login.nickname && doc.nickname === login.nickname) return doc 
    //^ Important to only try nickname match if a nickname was provided.
  }, function(err, doc) {
    //If user exists:
    if(doc) {
      var msg 
      if(doc.email == login.email) msg = 'A user with that email already exists.'
      if(login.nickname && doc.nickname == login.nickname) msg = 'That nickname is already taken.'
      return callback(msg)
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
          //Now create a unique database for the user:
          var userDbName = baseURL.split("/").pop() + '_user_' + res.id
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
            //Return the signup token and a copy of the userdoc: 
            if(callback) return callback(null, {
              signup_token: doc.signup_token, 
              user_doc: userDoc
            })
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
    if(!doc) {
      if(callback) return callback('The token is invalid or expired.') 
      else return console.log('The token is invalid or expired.')
    }    
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
          if(callback) return callback(err)
          else return
        }
        doc._rev = res.rev

        //Do a one time sync: 
        couchParty.syncSomeone(baseURL, doc.db_id, true)        
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
      console.log('Change detected for ' + userId)
      //Put in the master users db...
      //overwrite, mirroring the two docs: 
      dbUsers.get(userId, function(err, dbUsersDoc) {
        //apply the existing rev and id: 
        if(err) return console.log(err)
        change.doc._rev = dbUsersDoc._rev
        change.doc._id = dbUsersDoc._id
        dbUsers.put(change.doc, function(err, res) {
          if(err) return console.log(err) 
          console.log('Change applied to partyDB successfully.')            
        })
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

//Take the given user's doc from primary db and use it to extend the user doc in it's secondary db: 
couchParty.primaryExtend = function(baseURL, userId, callback) {
  var dbUsers = new PouchDB(baseURL + '_users')  
  var userDb = new PouchDB(baseURL + '_user_' + userId) 

  //Put in the master users db...
  //overwrite, mirroring the two docs: 
  dbUsers.get(userId, function(err, userDoc) {
    if(err) return console.log(err)
    userDoc._id = 'user'
    _pouch.extend(userDb, 'user', userDoc, function(newDoc) {
      callback(null, newDoc)
    })
  })
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
      couchParty.syncSomeone(baseURL, doc.db_id, false, true)      
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
      //Apply change to userDb...
      var userDb = new PouchDB(baseURL + '_user_' + userDoc._id) 
      userDb.get('user', function(err, existingUserDoc) { //< get the rev
        existingUserDoc.password = hash        
        //delete unneeded token: 
        delete existingUserDoc.secret_token
        //now update: 
        userDb.put(existingUserDoc, function(err, res) {
          if(err) return console.log(err)
          //and do a sync to ensure change is applied to back master usersDb: 
          couchParty.syncSomeone(baseURL, userDoc.db_id)     
          callback(null)                        
        })        
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

couchParty.isNickAvail = function(baseURL, nickname, callback) {
  var dbUsers = new PouchDB(baseURL + '_users')
  _pouch.findWhere(dbUsers, { nickname: nickname }, function(doc) {
    if(doc) return callback(false) 
    else return callback(true)
  })
}

//Selectively filter user data from partyDB to the publicDB: 
//(ie: for public facing data on user profile pages)
couchParty.publicParty = function(baseURL, fields) {
  var publicDB = new PouchDB(baseURL + '_public')
  var partyDB = new PouchDB(baseURL + '_users')
  partyDB.changes({ live: true, since: 'now', include_docs: true })
    .on('change', function(change) {
      console.log('there was a partyDB change...')
      //For the changed document; send only the fields provided...
      //as well as the _id:       
      fields.push('_id')
      var doc = _.pick(change.doc, fields)
      _pouch.replace(publicDB, doc, (res) => console.log('replaced doc'))
    })
}

module.exports = couchParty
