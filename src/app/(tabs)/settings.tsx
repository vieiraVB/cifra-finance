import { useState } from "react";
import { router } from "expo-router";
import { Alert, Pressable, StyleSheet, Text, View } from "react-native";
import * as FileSystem from "expo-file-system/legacy";
import * as Sharing from "expo-sharing";
import { useSQLiteContext } from "expo-sqlite";
import { Screen } from "@/components/Screen";
import { colors } from "@/theme/colors";

export default function SettingsScreen() {
  const db = useSQLiteContext();
  const [exporting, setExporting] = useState(false);
  const [resetting, setResetting] = useState(false);

  async function exportDatabase() {
    if (exporting) return;
    setExporting(true);
    try {
      await db.execAsync("PRAGMA wal_checkpoint(FULL);");
      const source = `${FileSystem.documentDirectory}SQLite/finance.db`;
      const info = await FileSystem.getInfoAsync(source);
      if (!info.exists) throw new Error("O arquivo finance.db não foi encontrado no armazenamento do aplicativo.");
      const destination = `${FileSystem.cacheDirectory}finance-backup-${Date.now()}.db`;
      await FileSystem.copyAsync({ from: source, to: destination });
      if (!(await Sharing.isAvailableAsync())) throw new Error("O compartilhamento não está disponível neste dispositivo.");
      await Sharing.shareAsync(destination, {
        mimeType: "application/x-sqlite3",
        dialogTitle: "Exportar banco de dados do Cifra",
        UTI: "public.database",
      });
    } catch (error) {
      Alert.alert("Falha no backup", error instanceof Error ? error.message : "Não foi possível exportar o banco.");
    } finally {
      setExporting(false);
    }
  }

  function confirmReset() {
    Alert.alert(
      "Zerar banco para testes?",
      "Isso apagará contas, movimentações, importações, cartões, faturas e empréstimos deste aplicativo. As categorias padrão serão mantidas. Exporte um backup antes se quiser guardar os dados.",
      [
        { text: "Cancelar", style: "cancel" },
        { text: "Zerar banco", style: "destructive", onPress: () => void resetDatabase() },
      ]
    );
  }

  async function resetDatabase() {
    if (resetting) return;
    setResetting(true);
    try {
      await db.withTransactionAsync(async () => {
        await db.execAsync(`
          DELETE FROM loan_payments;
          DELETE FROM transactions;
          DELETE FROM import_items;
          DELETE FROM imports;
          DELETE FROM loans;
          DELETE FROM invoices;
          DELETE FROM cards;
          DELETE FROM installments;
          DELETE FROM accounts;
          DELETE FROM settings;
        `);
      });
      Alert.alert("Banco zerado", "O banco está pronto para os novos testes. As categorias padrão foram preservadas.");
    } catch (error) {
      Alert.alert("Falha ao zerar", error instanceof Error ? error.message : "Não foi possível limpar o banco.");
    } finally {
      setResetting(false);
    }
  }

  return <Screen>
    <Text style={styles.kicker}>PREFERÊNCIAS</Text>
    <Text style={styles.title}>Configurações</Text>
    <View style={styles.card}>
      <Text style={styles.cardTitle}>Armazenamento local</Text>
      <Text style={styles.body}>Seus registros são mantidos no banco SQLite do próprio iPhone. O aplicativo não envia suas movimentações para servidores.</Text>
    </View>
    <View style={styles.card}>
      <Text style={styles.cardTitle}>Cartões identificadores</Text>
      <Text style={styles.body}>Cadastre cartões pelos quatro últimos dígitos. Quando o extrato trouxer essa identificação, as compras serão associadas automaticamente. Limite, fechamento e vencimento são opcionais e não são exigidos.</Text>
      <Pressable onPress={() => router.push("/cards")} style={styles.button}>
        <Text style={styles.buttonText}>Gerenciar cartões</Text>
      </Pressable>
    </View>
    <View style={styles.card}>
      <Text style={styles.cardTitle}>Backup e restauração</Text>
      <Text style={styles.body}>Exporte uma cópia do banco SQLite com suas contas, movimentações e importações. Envie o arquivo exportado para análise ou guarde como backup.</Text>
      <Pressable onPress={() => void exportDatabase()} disabled={exporting} style={[styles.button, exporting && { opacity: 0.6 }]}>
        <Text style={styles.buttonText}>{exporting ? "Preparando banco..." : "Exportar banco de dados (.db)"}</Text>
      </Pressable>
      <Text style={styles.note}>O arquivo contém dados financeiros pessoais. Compartilhe somente com quem você confia.</Text>
    </View>
    <View style={styles.card}>
      <Text style={styles.cardTitle}>Laboratório de testes</Text>
      <Text style={styles.body}>Limpe os dados financeiros do aplicativo para começar uma bateria de importações do zero. As categorias padrão permanecem disponíveis.</Text>
      <Pressable onPress={confirmReset} disabled={resetting} style={[styles.dangerButton, resetting && { opacity: 0.6 }]}>
        <Text style={styles.buttonText}>{resetting ? "Limpando..." : "Zerar banco para novos testes"}</Text>
      </Pressable>
    </View>
    <View style={styles.footer}><Text style={styles.footerText}>CIFRA · VERSÃO 1.0.0</Text></View>
  </Screen>;
}
const styles = StyleSheet.create({
  kicker: { color: colors.primary, fontSize: 10, fontWeight: "800", letterSpacing: 1.4 },
  title: { color: colors.text, fontSize: 28, fontWeight: "800", marginTop: 5 },
  card: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: 17, padding: 18, marginTop: 17 },
  cardTitle: { color: colors.text, fontSize: 15, fontWeight: "700" },
  body: { color: colors.muted, fontSize: 12, lineHeight: 19, marginTop: 8 },
  button: { marginTop: 15, borderRadius: 12, paddingVertical: 13, alignItems: "center", backgroundColor: colors.primary },
  dangerButton: { marginTop: 15, borderRadius: 12, paddingVertical: 13, alignItems: "center", backgroundColor: "#9B303B" },
  buttonText: { color: "#FFFFFF", fontSize: 13, fontWeight: "800" },
  note: { color: colors.muted, fontSize: 10, lineHeight: 15, marginTop: 10 },
  footer: { alignItems: "center", marginTop: 30 },
  footerText: { color: colors.muted, fontSize: 9, letterSpacing: 1.3, fontWeight: "700" },
});
