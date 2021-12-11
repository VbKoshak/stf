const request = require('request-promise')
const Promise = require('bluebird')
const syrup = require('@devicefarmer/stf-syrup')
const logger = require('../../../../util/logger')
const iosutil = require('../util/iosutil')
const wireutil = require('../../../../wire/util')
const wire = require('../../../../wire')

const LOG_API_REQUEST_MSG = 'Has been sent api request to WDA with data :'

module.exports = syrup.serial()
  .dependency(require('../devicenotifier'))
  .dependency(require('../../support/push'))
  .define((options, notifier, push) => {
    const log = logger.createLogger('wdaClient')
    log.info("WdaClient.js initializing...")

    const WdaClient = {
      baseUrl: iosutil.getUri(options.wdaHost, options.wdaPort),

      sessionId: null,
      deviceSize: null,

      touchDownParams: {},
      isMove: false,
      tapStartAt: 0,

      orientation: 'PORTRAIT',

      startSession: function() {
        let params = {
          capabilities: {}
        }

        return new Promise((resolve, reject) => {
          log.info("starting wda session...")
          this.handleRequest({
            method: 'POST',
            uri: `${this.baseUrl}/session`,
            body: params,
            json: true
          })
          .then(response => {
            log.info("startSession response: " + JSON.stringify(response))
            // {"value":{"sessionId":"C4A07D30-E2E2-4922-9829-2B3ED2C4DBAE",
            //    "capabilities":{"device":"iphone","browserName":" ","sdkVersion":"14.7.1","CFBundleIdentifier":"com.apple.springboard"}},
            //    "sessionId":"C4A07D30-E2E2-4922-9829-2B3ED2C4DBAE"}
            this.sessionId = response.sessionId
            log.info('sessionId: ' + this.sessionId)
            return this.size()
          })
          .catch(err => {
            log.error('"startSession" No valid response from web driver!', err)
            return reject(err)
          })
        })
      },
      stopSession: function() {
        log.info("stopping wda session...")
        let currentSessionId = this.sessionId
        this.sessionId = null
        return this.handleRequest({
          method: 'DELETE',
          uri: `${this.baseUrl}/session/${currentSessionId}` 
        })
      },
      typeKey: function(params) {
        if (!params.value || !params.value[0]) {
          return
        }

        log.info("typeKeys: " + params)
        return this.handleRequest({
          method: 'POST',
          uri: `${this.baseUrl}/session/${this.sessionId}/wda/keys`,
          body: params,
          json: true
        })
      },
      tap: function(params) {
        this.tapStartAt = (new Date()).getTime()
        this.touchDownParams = params
        this.isMove = false
      },
      homeBtn: function() {
        return this.handleRequest({
          method: 'POST',
          uri: `${this.baseUrl}/wda/homescreen`
        })
      },
      setScaleByRotation: function(params, deviceSize) {
        return iosutil.swipe(this.orientation, params, deviceSize)
      },
      swipe: function(params) {
        const scale = this.setScaleByRotation(params, this.deviceSize)
        this.isMove = true
        return this.handleRequest({
          method: 'POST',
          uri: `${this.baseUrl}/session/${this.sessionId}/wda/dragfromtoforduration`,
          body: scale,
          json: true
        })
      },
      touchUp: function() {
        if(!this.isMove) {
          const {x, y} = this.touchDownParams
          let params = {
            x: x * this.deviceSize.width,
            y: y * this.deviceSize.height
          }

          if(((new Date()).getTime() - this.tapStartAt) <= 1000 || !this.tapStartAt) {
            return this.handleRequest({
              method: 'POST',
              uri: `${this.baseUrl}/session/${this.sessionId}/wda/tap/0`,
              body: params,
              json: true
            })
          } else {
            return this.handleRequest({
              method: 'POST',
              uri: `${this.baseUrl}/session/${this.sessionId}/wda/touchAndHold`,
              body: Object.assign(params, {duration: 1}),
              json: true
            })
          }
        }
      },
      tapDeviceTreeElement: function(message) {
        const params = {
          using: 'link text',
          value: 'label=' + message.label,
        }

        return new Promise((resolve, reject) => {
          this.handleRequest({
            method: 'POST',
            uri: `${this.baseUrl}/session/${this.sessionId}/elements`,
            body: params,
            json: true
          })
          .then(response => {
            const {ELEMENT} = response.value[0]
            return this.handleRequest({
              method: 'POST',
              uri: `${this.baseUrl}/session/${this.sessionId}/element/${ELEMENT}/click`,
              body: {},
              json: true
            })
          })
          .catch(err => {
            log.error(err)
          })
        })
      },
      doubleClick: function() {
        if(!this.isMove) {
          const {x, y} = this.touchDownParams
          const params = {
            x: x * this.deviceSize.width,
            y: y * this.deviceSize.height
          }

          return this.handleRequest({
            method: 'POST',
            uri: `${this.baseUrl}/session/${this.sessionId}/wda/doubleTap`,
            body: params,
            json: true
          })
        }
      },
      size: function() {
        log.info(`window size: ${this.baseUrl}/session/${this.sessionId}/window/size`)

        return new Promise((resolve, reject) => {
          this.handleRequest({
            method: 'GET',
            uri: `${this.baseUrl}/session/${this.sessionId}/window/size`
          })
          .then(response => {
            try {
              this.deviceSize = JSON.parse(response).value
              return resolve(this.deviceSize)
            }
            catch (e) {
              return reject(new Error('Failed to parse json object'))
            }
          })
          .catch(err => {
            return reject(err)
          })
        })
      },
      openUrl: function(message) {
        const params = {
          url: message.url
        }

        return this.handleRequest({
          method: 'POST',
          uri: `${this.baseUrl}/session/` + this.sessionId + `/url`,
          body: params,
          json: true
        })
      },
      screenshot: function() {
        return new Promise((resolve, reject) => {
          this.handleRequest({
            method: 'GET',
            uri: `${this.baseUrl}/screenshot`,
            json: true
          })
          .then(response => {
            try {
              resolve(response)
            } catch(e) {
              reject(e)
            }
          })
          .catch(err => reject(err))
        })
      },
      rotation: function(params) {
        this.orientation = params.orientation

          return this.handleRequest({
            method: 'POST',
            uri: `${this.baseUrl}/session/${this.sessionId}/orientation`,
            body: params,
            json: true
          })
      },
      orientation: function(params) {
        this.orientation = params.orientation

        return this.handleRequest({
          method: 'POST',
          uri: `${this.baseUrl}/session/${this.sessionId}/orientation`,
          body: params,
          json: true
        })
      },
      getTreeElements: function() {
        return this.handleRequest({
          method: 'GET',
          uri: `${this.baseUrl}/source?format=json`,
          json: true
        })
      },
      pressButton: function(params) {
        return this.handleRequest({
            method: 'POST',
            uri: `${this.baseUrl}/session/${this.sessionId}/wda/pressButton`,
            body: {
              name: params
            },
            json: true
        })
      },
      appActivate: function(params) {
        return this.handleRequest({
            method: 'POST',
            uri: `${this.baseUrl}/session/${this.sessionId}/wda/apps/activate`,
            body: {
              bundleId: params
            },
            json: true
        })
      },
      pressPower: function() {
        return this.handleRequest({
          method: 'GET',
          uri: `${this.baseUrl}/session/${this.sessionId}/wda/locked`,
          json: true
        })
        .then(response => {
          let url = ''
          if(response.value === true) {
            url = `${this.baseUrl}/session/${this.sessionId}/wda/unlock`
          } else {
            url = `${this.baseUrl}/session/${this.sessionId}/wda/lock`
          }
          return this.handleRequest({
            method: 'POST',
            uri: url,
            json: true
          })
        })
      },
      handleRequest: function(requestOpt) {
        return new Promise((resolve, reject) => {
          request(requestOpt)
          .then(response => {
            log.verbose(LOG_API_REQUEST_MSG, JSON.stringify(requestOpt))
            return resolve(response)
          })
          .catch(err => {
            notifier.setDeviceTemporaryUnavialable(err)
            return reject(err)
          })
        })
      },
  }

  return WdaClient
})
