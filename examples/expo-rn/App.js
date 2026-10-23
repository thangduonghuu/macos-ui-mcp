// Minimal React Native screen for the harness e2e (test/e2e-rn.test.ts): a Pressable
// with a Text inside, a TextInput whose JS state is echoed back, and a ScrollView.
import { useState } from "react";
import { Pressable, SafeAreaView, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";

export default function App() {
  const [screen, setScreen] = useState(1);
  const [typed, setTyped] = useState("");

  if (screen === 2) {
    return (
      <SafeAreaView style={styles.root}>
        <Text testID="screen2-title" style={styles.title}>Màn 2</Text>
        <Pressable testID="back" style={styles.button} onPress={() => setScreen(1)}>
          <Text style={styles.buttonText}>Quay lại</Text>
        </Pressable>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.root}>
      <Text testID="status" style={styles.title}>{`Typed: ${typed}`}</Text>
      <TextInput
        testID="email"
        placeholder="Email"
        autoCapitalize="none"
        autoCorrect={false}
        style={styles.input}
        value={typed}
        onChangeText={setTyped}
      />
      <Pressable style={styles.button} onPress={() => setScreen(2)}>
        <Text style={styles.buttonText}>Tiếp</Text>
      </Pressable>
      <ScrollView testID="list" style={styles.list}>
        {Array.from({ length: 30 }, (_, i) => (
          <View key={i} style={styles.row}>
            <Text testID={`item-${i + 1}`}>{`Item ${i + 1}`}</Text>
          </View>
        ))}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, padding: 20, gap: 12 },
  title: { fontSize: 18, marginHorizontal: 20, marginTop: 12 },
  input: { marginHorizontal: 20, borderWidth: 1, borderColor: "#999", borderRadius: 6, padding: 10 },
  button: { marginHorizontal: 20, backgroundColor: "#2563eb", borderRadius: 8, padding: 12 },
  buttonText: { color: "white", textAlign: "center", fontSize: 16 },
  list: { marginHorizontal: 20, maxHeight: 240 },
  row: { height: 40, justifyContent: "center" },
});
