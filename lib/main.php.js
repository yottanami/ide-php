const cp = require('child_process')
const fs = require('fs')
const net = require('net')
const path = require('path')
const {shell} = require('electron')
const {AutoLanguageClient, DownloadFile} = require('atom-languageclient')


const serverLauncher = path.join('felixfbecker', 'language-server', 'bin', 'php-language-server.php')
const minRubyRuntime = 1

class RubyLanguageClient extends AutoLanguageClient {
  getGrammarScopes () { return [ 'source.rb' ] }
  getLanguageName () { return 'Ruby' }
  getServerName () { return 'ruby' }


  constructor () {
    super()
    this.busySignalElement = null
  }

  startServerProcess () {
    const serverHome = path.join(__dirname, '..', 'vendor')
    return this.getOrInstallServer(serverHome).then(() =>
      this.getConnectionType() === 'socket' ? this.spawnServerWithSocket() : this.spawnServer()
    )
  }

  spawnServerWithSocket () {
    return new Promise((resolve, reject) => {
      let childProcess
      const server = net.createServer(socket => {
        // When the language server connects, grab socket, stop listening and resolve
        this.socket = socket
        server.close()
        resolve(childProcess)
      })
      server.listen(0, '127.0.0.1', () => {
        // Once we have a port assigned spawn the Language Server with the port
        childProcess = this.spawnServer([`--tcp=127.0.0.1:${server.address().port}`])
      })
    })
  }

  checkRubyVersion (command) {
    return new Promise((resolve, reject) => {
      const childProcess = cp.spawn(command, [ '-r', 'echo phpversion();' ])
      childProcess.on('error', err => {
        let description = err.code == 'ENOENT'
          ? `No PHP interpreter found at <b>${command}</b>.`
          : `Could not spawn the PHP interpreter <b>${command}</b>.`
        atom.notifications.addError('IDE-PHP could not launch your PHP runtime.', {
          dismissable: true,
          buttons: [
            { text: 'Set PHP Path', onDidClick: () => this.openPackageSettings() },
            { text: 'Download PHP', onDidClick: () => this.downloadPHP() },
          ],
          description: `${description}<p>If you have PHP ${minPHPRuntime} installed please Set PHP Path correctly. If you do not please Download PHP ${minPHPRuntime} or later and install it.</p><code>${err.message}</code>`

        })
        reject()
      })
      let stdErr = '', stdOut = ''
      childProcess.stderr.on('data', chunk => stdErr += chunk.toString())
      childProcess.stdout.on('data', chunk => stdOut += chunk.toString())
      childProcess.on('close', exitCode => {
        if (exitCode === 0 && stdOut != '') {
          this.logger.debug(`Using PHP ${version} from ${command}`)
          if (Number(stdOut.split('.')[0]) >= minPHPRuntime) {
            resolve()
          } else {
            atom.notifications.addError(`IDE-PHP requires PHP ${minPHPRuntime} or later but found ${stdOut}`, {
              dismissable: true,
              buttons: [
                { text: 'Set PHP Path', onDidClick: () => this.openPackageSettings() },
                { text: 'Download PHP', onDidClick: () => this.downloadPHP() },
              ],
              description: `If you have PHP ${minPHPRuntime} installed please Set PHP Path correctly. If you do not please Download PHP ${minPHPRuntime} or later and install it.`
            })
            reject()
          }
        } else {
          atom.notifications.addError('IDE-PHP encounted an error using the PHP runtime.', {
            dismissable: true,
            description: stdErr != null ? `<code>${stdErr}</code>` : `Exit code ${exitCode}`
          })
          reject()
        }
      })
    })
  }

  downloadPHP () {
    shell.openExternal('https://secure.php.net/downloads.php')
  }

  spawnServer (extraArgs) {
    const command = this.getPHPCommand()

    return this.checkRubyVersion(command).then(() => {
      const serverHome = path.join(__dirname, '..', 'vendor')

      // Temporarily set the default to 2GB as language server defaults to 4GB which fails on 32-bit systems
      const memoryLimit = this.getMemoryLimit() === '-1' ? '2G' : this.getMemoryLimit()
      const args = [ serverLauncher, '--memory-limit=' + memoryLimit ]
      if (extraArgs) {
        args.push(extraArgs)
      }

      this.logger.debug(`starting "${command} ${args.join(' ')}"`)
      const childProcess = cp.spawn(command, args, { cwd: serverHome })
      this.captureServerErrors(childProcess)
      childProcess.on('exit', exitCode => {
        if (exitCode != 0 && exitCode != null) {
          atom.notifications.addError('IDE-PHP language server stopped unexpectedly.', {
            dismissable: true,
            description: this.processStdErr != null ? `<code>${this.processStdErr}</code>` : `Exit code ${exitCode}`
          })
        }
      })
      return childProcess
    })
  }

  openPackageSettings() {
    atom.workspace.open("atom://config/packages/ide-php")
  }

  getOrInstallServer (serverHome) {
    return this.fileExists(path.join(serverHome, serverLauncher))
      .then(doesExist => { if (!doesExist) return this.installServer(serverHome) })
  }

  installServer (serverHome) {
    const localFileName = path.join(serverHome, 'download.tar.gz')
    const decompress = require('decompress')
    this.logger.log(`Downloading ${serverDownloadUrl} to ${localFileName}`);
    return this.fileExists(serverHome)
      .then(doesExist => { if (!doesExist) fs.mkdirSync(serverHome) })
      .then(() => DownloadFile(serverDownloadUrl, localFileName, (bytesDone, percent) => this.updateBusySignal(`downloading ${percent}%`), serverDownloadSize))
      .then(() => this.updateBusySignal('unpacking'))
      .then(() => decompress(localFileName, serverHome))
      .then(() => this.updateBusySignal())
      .then(() => this.fileExists(path.join(serverHome, serverLauncher)))
      .then(doesExist => { if (!doesExist) throw Error(`Failed to install the ${this.getServerName()} language server`) })
      .then(() => fs.unlinkSync(localFileName))
  }

  preInitialization(connection) {
    this.updateBusySignal()
  }

  updateBusySignal (text) {
    if (!this.busySignal) {
      // busy signal not available
      return;
    }

    if (text == null || text === '') {
      if (this.busySignalElement != null) {
        this.busySignalElement.dispose()
        this.busySignalElement = null
      }
    } else if (this.busySignalElement == null) {
      this.busySignalElement = this.busySignal.reportBusy(`${this.name} ${text}`, { revealTooltip: true })
    } else {
      this.busySignalElement.setTitle(`${this.name} ${text}`)
    }
  }

  consumeBusySignal (busySignal) {
    this.busySignal = busySignal
  }

  getPHPCommand () {
    const configuredPath = atom.config.get('ide-php.phpPath')
    if (configuredPath != null && configuredPath != '') {
        return configuredPath
    }

    const phpHome = process.env['PHP_HOME']
    if (configuredPath != null && configuredPath != '') {
      return path.join(phpHome, 'php')
    }

    return 'php'
  }

  getMemoryLimit () {
    const memoryLimit = atom.config.get('ide-php.memoryLimit') || '-1'

    if (memoryLimit != '-1' && !/^\d+[KMG]?$/.test(memoryLimit)) {
      atom.notifications.addError(`Invalid memory limit setting of ${memoryLimit}`, {
        dismissable: true,
        buttons: [ { text: 'Set Memory Limit', onDidClick: () => this.openPackageSettings() } ],
        description: 'The memory limit setting should be set to -1, a numeric value or PHP shorthand notation such as 100M, 2G.'
      })
      return '-1'
    }

    return memoryLimit;
  }

  getConnectionType() {
    const configConnectionType = atom.config.get('ide-php.connectionType')
    switch (configConnectionType) {
      case 'auto':    return process.platform === 'win32' ? 'socket' : 'stdio';
      case 'socket':  return 'socket';
      case 'stdio':   return 'stdio';
      default:
        atom.notifications.addWarning('Invalid connection type setting', {
          dismissable: true,
          buttons: [ { text: 'Set Connection Type', onDidClick: () => this.openPackageSettings() } ],
          description: 'The connection type setting should be set to "auto", "socket" or "stdio". "auto" is "socket" on Window and "stdio" on other platforms.'
        })
    }
  }

  fileExists (path) {
    return new Promise((resolve, reject) => {
      fs.access(path, fs.R_OK, error => {
        resolve(!error || error.code !== 'ENOENT')
      })
    })
  }

  deleteFileIfExists (path) {
    return new Promise((resolve, reject) => {
      fs.unlink(path, error => {
        if (error && error.code !== 'ENOENT') { reject(error) } else { resolve() }
      })
    })
  }
}

module.exports = new PHPLanguageClient()
