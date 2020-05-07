/**
 * webusb.js
 */

import Layout from '../keyboard/kleparser.js'
// webusb 

const WEBUSB_VENDOR_CODE    = 0x42      // webusb vender code
const WEBUSB_URL_INDEX      = 0
const WEBUSB_REQUEST_URL    = 2
const WEBUSB_URL_MAX        = 128

// current use a 32 byte packet for communication
// byte 0: version
// byte 1: command id
// byte 2....31: parameters

const CMD_BUFFER_SIZE   = 32
const CMD_ERROR_MASK    = 0x80  // the highest bit of command byte will be set while in error
const CMD_VERSION       = 0x01  // current verison was 1
const CMD_GET_KEYBOARD  = 0x02  // get keyboard information[key count][row count][column count][layer count]
const CMD_GET_POSITION  = 0x03  // get the key positon[key index][row index][column index]
const CMD_SET_KEYCODE   = 0x04  // set the keycode[layer][row index][column index][keycode(2 bytes)]
const CMD_GET_KEYCODE   = 0x05  // get the keycode[layer][row index][column index][keycode(2 bytes)]

class Webusb {
/*    getDevices() {
        return navigator.usb.getDevices.then(devices => {
            this.devices = devices
            return this.devices
        })
    }
    */

    async connect(device) {
        this.device = device
        await this.device.open()
        if (this.device.configuration === null) {
            await this.device.selectConfiguration(1)
        }

        let interfaces = this.device.configuration.interfaces;
        interfaces.forEach(element => {
            element.alternates.forEach(elem_alt => {
                if (elem_alt.interfaceClass === 0xFF) {
                    this.interfaceNumber = element.interfaceNumber
                    elem_alt.endpoints.forEach(ep => {
                        if (ep.direction === "out") {
                            this.endpointOut = ep.endpointNumber
                        }
                        if (ep.direction === "in") {
                            this.endpointIn = ep.endpointNumber
                        }
                    })
                }
            })
        })
        await this.device.claimInterface(this.interfaceNumber)
        await this.device.selectAlternateInterface(this.interfaceNumber, 0)
        this.connected = true

        return this.connected
    }

    disconnect() {
        this.device.close()
    }

    parseUrl(data) {
        let size = data.getUint8(0)
        let desc_type = data.getUint8(1)
        let schema = data.getUint8(2)
        let url = []
        console.log(desc_type)
        for (let i = 0; i < size-3; i++) {
            url += String.fromCharCode(data.getUint8(3+i))
        }
        if (schema === 0) {
            return "http://" + url
        } else if (schema === 1) {
            return "https://" + url
        } else {
            return null
        }
    }

    parseKeyboard(data) {
        let cmd = data.getUint8(1)
        console.log("load keyboard cmd: " + cmd)
        let keys = data.getUint8(2)
        let rows = data.getUint8(3)
        let cols = data.getUint8(4)
        let layers = data.getUint8(5)
        this.keyboard = {'keys':keys, 'rows':rows, 'cols':cols, 'layers':layers}
        return this.keyboard
    }

    parsePosition(data) {
        let index = data.getUint8(2)
        let row = data.getUint8(3)
        let col = data.getUint8(4)
        return {'index':index, 'row':row, 'col':col}
    }

    isValid(cmd) {
        return cmd&CMD_ERROR_MASK > 0 ? false : true
    }
    async getUrl() {
        let { data, status } = await this.device.controlTransferIn({
            requestType: 'vendor',
            recipient: 'device',
            request: WEBUSB_VENDOR_CODE,    // vendor-specific request
            value: WEBUSB_URL_INDEX,        // webusb landing page url
            index: WEBUSB_REQUEST_URL        // webusb request type 
        }, WEBUSB_URL_MAX);
        console.log(data)
        console.log(status)
        this.url = this.parseUrl(data)
        console.log(this.url)
        // todo load layout from this url
        return this.url
    }

    async loadLayout(url) {
        let resp = await fetch(url)
        let data = await resp.text()
        this.layout = Layout(data)
        return this.layout
    }

    async loadKeyboard() {
        if (this.connected !== true) {
            console.log("need to connect keyboard first")
        }

        let buffer = new ArrayBuffer(CMD_BUFFER_SIZE)
        let cmd = new Uint8Array(buffer)
        cmd[0] = CMD_VERSION
        cmd[1] = CMD_GET_KEYBOARD
        await this.device.transferOut(this.endpointOut, buffer)

        let data = await this.device.transferIn(this.endpointIn, CMD_BUFFER_SIZE)
        while (data.data.byteLength === 0) {
            data = await this.device.transferIn(this.endpointIn, CMD_BUFFER_SIZE)
        }
        
        console.log(data.status)
        return this.parseKeyboard(data.data)
    }

    async loadKey(index) {
        let buffer = new ArrayBuffer(CMD_BUFFER_SIZE)
        let cmd = new Uint8Array(buffer)
        cmd[0] = CMD_VERSION
        cmd[1] = CMD_GET_POSITION
        cmd[2] = index
        await this.device.transferOut(this.endpointOut, buffer)
        let data = await this.device.transferIn(this.endpointIn, CMD_BUFFER_SIZE)
        while (data.data.byteLength === 0) {
            data = await this.device.transferIn(this.endpointIn, CMD_BUFFER_SIZE)
        }
        console.log(data.status)
        return this.parsePosition(data.data)
    }

    async loadKeymap() {
        this.keymap = []
        for (let i = 0; i < this.keyboard.keys; i++) {
            let {index, row, col} = await this.loadKey(i)
            // put row, colum to some where
            console.log("index:" + index + " row: " + row + " col: " + col)
            this.keymap.push({'row':row, 'col':col})
        }
        return this.keymap
    }

    async setKeycode(layer, row, column, code) {
        let buffer = new ArrayBuffer(CMD_BUFFER_SIZE)
        let cmd = new DataView(buffer)
        cmd.setUint8(0, CMD_VERSION)
        cmd.setUint8(1, CMD_SET_KEYCODE)
        cmd.setUint8(2, layer)
        cmd.setUint8(3, row)
        cmd.setUint8(4, column)
        cmd.setUint8(5, code>>8)
        cmd.setUint8(6, code&0xFF)
        await this.device.transferOut(this.endpointOut, buffer)
        let data = await this.device.transferIn(this.endpointIn, CMD_BUFFER_SIZE)
        while (data.data.byteLength === 0) {
            data = await this.device.transferIn(this.endpointIn, CMD_BUFFER_SIZE)
        }
        console.log(data.status)
    }

    async getKeycode(layer, row, col) {
        let buffer = new ArrayBuffer(CMD_BUFFER_SIZE)
        let cmd = new Uint8Array(buffer)
        cmd[0] = CMD_VERSION
        cmd[1] = CMD_GET_KEYCODE
        cmd[2] = layer
        cmd[3] = row
        cmd[4] = col
        await this.device.transferOut(this.endpointOut, buffer)
        let data  = await this.device.transferIn(this.endpointIn, CMD_BUFFER_SIZE)
        while (data.data.byteLength === 0) {
            data = await this.device.transferIn(this.endpointIn, CMD_BUFFER_SIZE)
        }
        console.log(data.status)
        let code = (data.data.getUint8(5) << 8) | (data.data.getUint8(6))
        console.log(code)
        return {'layer':layer, 'row':row, 'col': col, 'code':code}
    }

    async loadLayer(num) {
        let layer = []
        for (let i = 0; i < this.keymap.length; i++) {
            let keycode = await this.getKeycode(num, this.keymap[i].row, this.keymap[i].col)
            layer.push(keycode.code)
        }

        return layer
    }
}

export default Webusb 