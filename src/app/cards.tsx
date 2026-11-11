import { useCallback, useState } from "react";
import { Alert, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { useFocusEffect } from "expo-router";
import { useSQLiteContext } from "expo-sqlite";
import { Screen } from "@/components/Screen";
import { colors } from "@/theme/colors";

type CardRow = { id: string; name: string; brand: string | null; institution: string | null; last4: string | null; is_archived: number };
const makeId = () => `card_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

export default function CardsScreen() {
  const db = useSQLiteContext();
  const [cards, setCards] = useState<CardRow[]>([]);
  const [institution, setInstitution] = useState("Nubank");
  const [last4, setLast4] = useState("");
  const [alias, setAlias] = useState("");
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    const rows = await db.getAllAsync<CardRow>("SELECT id, name, brand, institution, last4, is_archived FROM cards ORDER BY is_archived, institution, name");
    setCards(rows);
  }, [db]);
  useFocusEffect(useCallback(() => { void load(); }, [load]));

  async function createCard() {
    const cleanInstitution = institution.trim();
    const cleanLast4 = last4.replace(/\D/g, "");
    if (!cleanInstitution || cleanLast4.length !== 4) {
      Alert.alert("Confira os dados", "Informe a instituição e os quatro últimos dígitos do cartão.");
      return;
    }
    setSaving(true);
    try {
      const existing = await db.getFirstAsync<{ id: string }>("SELECT id FROM cards WHERE LOWER(institution) = LOWER(?) AND last4 = ?", cleanInstitution, cleanLast4);
      if (existing) {
        Alert.alert("Cartão já cadastrado", "Já existe um cartão dessa instituição com esses quatro últimos dígitos.");
        return;
      }
      const now = new Date().toISOString();
      const id = makeId();
      const name = alias.trim() || `${cleanInstitution} final ${cleanLast4}`;
      await db.runAsync(
        `INSERT INTO cards (id, name, brand, credit_limit_cents, closing_day, due_day, is_archived, created_at, institution, last4)
         VALUES (?, ?, ?, 0, NULL, NULL, 0, ?, ?, ?)`,
        id, name, cleanInstitution, now, cleanInstitution, cleanLast4
      );
      setLast4(""); setAlias(""); await load();
      Alert.alert("Cartão cadastrado", `${name} poderá ser associado automaticamente quando o extrato informar esses quatro dígitos.`);
    } catch (error) {
      Alert.alert("Erro", error instanceof Error ? error.message : "Não foi possível cadastrar o cartão.");
    } finally { setSaving(false); }
  }

  return <Screen>
    <Text style={styles.kicker}>IDENTIFICAÇÃO DE CARTÕES</Text>
    <Text style={styles.title}>Meus cartões</Text>
    <Text style={styles.subtitle}>O cartão funciona como identificador das compras. Não é necessário informar limite, fechamento ou vencimento.</Text>
    <View style={styles.form}>
      <Text style={styles.label}>Instituição financeira</Text>
      <TextInput value={institution} onChangeText={setInstitution} placeholder="Ex.: Nubank" placeholderTextColor={colors.muted} style={styles.input}/>
      <Text style={styles.label}>Quatro últimos dígitos</Text>
      <TextInput value={last4} onChangeText={v => setLast4(v.replace(/\D/g, "").slice(0,4))} keyboardType="number-pad" maxLength={4} placeholder="Ex.: 8812" placeholderTextColor={colors.muted} style={styles.input}/>
      <Text style={styles.label}>Nome opcional</Text>
      <TextInput value={alias} onChangeText={setAlias} placeholder="Ex.: Nubank físico" placeholderTextColor={colors.muted} style={styles.input}/>
      <Pressable onPress={() => void createCard()} disabled={saving} style={[styles.button, saving && { opacity: .6 }]}><Text style={styles.buttonText}>{saving ? "Salvando..." : "Cadastrar cartão"}</Text></Pressable>
    </View>
    <Text style={styles.section}>Cartões identificados</Text>
    {cards.length === 0 ? <View style={styles.empty}><Text style={styles.subtitle}>Nenhum cartão cadastrado. Ao importar uma fatura que mostre os quatro últimos dígitos, o aplicativo poderá criar o identificador automaticamente.</Text></View> : cards.map(card => <View key={card.id} style={styles.card}><View style={{flex:1}}><Text style={styles.cardName}>{card.name}</Text><Text style={styles.cardMeta}>{card.institution || card.brand || "Instituição não informada"}{card.last4 ? ` · final ${card.last4}` : ""}</Text></View><Text style={styles.status}>{card.is_archived ? "Arquivado" : "Ativo"}</Text></View>)}
  </Screen>;
}

const styles = StyleSheet.create({
  kicker:{color:colors.primary,fontSize:10,fontWeight:"800",letterSpacing:1.4}, title:{color:colors.text,fontSize:28,fontWeight:"800",marginTop:5}, subtitle:{color:colors.muted,fontSize:12,lineHeight:19,marginTop:7},
  form:{backgroundColor:colors.surface,borderWidth:1,borderColor:colors.border,borderRadius:17,padding:16,marginTop:18}, label:{color:colors.text,fontSize:12,fontWeight:"700",marginTop:12,marginBottom:7}, input:{backgroundColor:colors.surfaceElevated,borderColor:colors.border,borderWidth:1,borderRadius:11,paddingHorizontal:12,paddingVertical:11,color:colors.text,fontSize:14}, button:{backgroundColor:colors.primaryStrong,borderRadius:12,paddingVertical:13,alignItems:"center",marginTop:17}, buttonText:{color:"#fff",fontWeight:"800",fontSize:13}, section:{color:colors.text,fontSize:16,fontWeight:"800",marginTop:24,marginBottom:10}, card:{backgroundColor:colors.surface,borderWidth:1,borderColor:colors.border,borderRadius:14,padding:15,marginBottom:9,flexDirection:"row",alignItems:"center"},cardName:{color:colors.text,fontSize:14,fontWeight:"800"},cardMeta:{color:colors.muted,fontSize:11,marginTop:5},status:{color:colors.success,fontSize:10,fontWeight:"800"},empty:{padding:15,backgroundColor:colors.surface,borderRadius:14,borderWidth:1,borderColor:colors.border}
});
