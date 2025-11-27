// React Native example for @just-every/code-bridge
// Add this to your App.tsx or App.js

import React, { useEffect } from 'react';
import { View, Text, Button, StyleSheet } from 'react-native';
import { startBridge } from '@just-every/code-bridge';

export default function App() {
  useEffect(() => {
    // Start the bridge in development mode
    const bridge = startBridge({
      url: 'ws://localhost:9876',
      secret: 'dev-secret',
      projectId: 'my-rn-app',
      // In React Native, __DEV__ is automatically set
      // enabled will default to true when __DEV__ is true
    });

    console.log('Code Bridge initialized');

    // Clean up on unmount
    return () => {
      bridge.disconnect();
    };
  }, []);

  const testLog = () => {
    console.log('Test log from React Native');
  };

  const testWarn = () => {
    console.warn('Test warning from React Native');
  };

  const testError = () => {
    console.error('Test error from React Native');
  };

  const testException = () => {
    try {
      throw new Error('Test exception from React Native');
    } catch (err) {
      console.error(err);
    }
  };

  const testUnhandledRejection = () => {
    Promise.reject(new Error('Test unhandled rejection from React Native'));
  };

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Code Bridge Demo</Text>
      <Text style={styles.status}>
        Bridge is active. Events are being sent to ws://localhost:9876
      </Text>

      <View style={styles.buttonContainer}>
        <Button title="Test Log" onPress={testLog} />
        <Button title="Test Warning" onPress={testWarn} />
        <Button title="Test Error" onPress={testError} />
        <Button title="Test Exception" onPress={testException} />
        <Button title="Test Unhandled Rejection" onPress={testUnhandledRejection} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
    backgroundColor: '#f5f5f5',
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    marginBottom: 10,
  },
  status: {
    fontSize: 14,
    color: '#666',
    marginBottom: 30,
    textAlign: 'center',
  },
  buttonContainer: {
    width: '100%',
    gap: 10,
  },
});
