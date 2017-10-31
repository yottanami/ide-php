class RubyLanguageClient extends AutoLanguageClient {
  getGrammarScopes () { return [ 'source.rb' ] }
  getLanguageName () { return 'Ruby' }
  getServerName () { return 'language_server-ruby' }

  getConnectionType() { return 'ipc' }

  startServerProcess () {
    const startServer = require.resolve('ruby')
    return super.spawnChildNode([startServer, '--node-ipc'], {
      stdio: [null, null, null, 'ipc']
    })
  }
}
