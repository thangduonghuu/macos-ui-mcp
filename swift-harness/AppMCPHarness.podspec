# CocoaPods entry point for the harness, used by the Expo config plugin (expo-plugin/).
# Link it for the Debug configuration only:
#   pod 'AppMCPHarness', :path => '../path/to/swift-harness', :configurations => ['Debug']
Pod::Spec.new do |s|
  s.name = 'AppMCPHarness'
  s.version = '0.1.0'
  s.summary = 'DEBUG-only harness that lets macos-ui-mcp inspect and drive the app UI.'
  s.homepage = 'https://github.com/thangduonghuu/macos-ui-mcp'
  s.license = { :type => 'MIT' }
  s.author = 'Thang Duong'
  s.source = { :git => 'https://github.com/thangduonghuu/macos-ui-mcp.git', :tag => s.version.to_s }
  s.ios.deployment_target = '16.0'
  s.osx.deployment_target = '13.0'
  s.swift_version = '5.9'
  s.source_files = 'Sources/AppMCPHarness/**/*.swift'
end
