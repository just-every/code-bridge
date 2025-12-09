Gem::Specification.new do |s|
  s.name        = 'code-bridge'
  s.version     = '0.0.1'
  s.summary     = 'Minimal Ruby client for Code Bridge protocol v2'
  s.description = s.summary
  s.author      = 'Code Bridge'
  s.email       = 'opensource@just.every'
  s.files       = Dir['lib/**/*.rb']
  s.homepage    = 'https://github.com/just-every/code-bridge'
  s.license     = 'MIT'
  s.required_ruby_version = '>= 3.0'
  s.add_dependency 'websocket-client-simple', '~> 0.6'
end
