import { AppRegistry } from 'react-native';
import { PluginManager } from 'sn-plugin-lib';
import App from './src/App';
import { name as appName } from './app.json';

AppRegistry.registerComponent(appName, () => App);

// Register toolbar button inside Supernote Note app (Chauvet 3.31.45+)
PluginManager.registerButton(1, ['NOTE'], {
  id: 'localsend_layer4_btn',
  name: 'LocalSend L4',
  icon: 'assets/icon.png',
  showType: 1
});
