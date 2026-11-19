import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'expo-router';
import { CameraView, useCameraPermissions, type BarcodeScanningResult } from 'expo-camera';
import {
  Alert,
  Modal,
  Pressable,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';

import { CardBlock } from '@/components/card-block';
import { Screen } from '@/components/screen';
import { ThemedText } from '@/components/themed-text';
import { UiButton } from '@/components/ui-button';
import { useTheme } from '@/hooks/use-theme';
import { currencyDecimals, formatMoney, parseAmount } from '@/money/dates';
import { lookupFoodProductName } from '@/money/product-lookup';
import {
  deleteCategory,
  deleteMoneyTag,
  deleteSubcategory,
  initializeMoneyTracker,
  loadMoneyManagementData,
  saveCategory,
  saveMoneyTag,
  saveSharedSubcategory,
} from '@/money/storage';
import type {
  MoneyCategory,
  MoneySubcategory,
  MoneyTag,
  TransactionType,
} from '@/money/types';
import { useDatabase } from '@/providers/database-provider';

type ManagerData = Awaited<ReturnType<typeof loadMoneyManagementData>>;

export default function MoneyManagementScreen() {
  const router = useRouter();
  const theme = useTheme();
  const { revision, refresh } = useDatabase();
  const [cameraPermission, requestCameraPermission] = useCameraPermissions();
  const scannerLocked = useRef(false);
  const [data, setData] = useState<ManagerData | null>(null);
  const [type, setType] = useState<TransactionType>('expense');
  const [categoryName, setCategoryName] = useState('');
  const [editingCategory, setEditingCategory] = useState<MoneyCategory | null>(null);
  const [selectedCategoryIds, setSelectedCategoryIds] = useState<string[]>([]);
  const [itemName, setItemName] = useState('');
  const [itemBarcode, setItemBarcode] = useState('');
  const [itemPrices, setItemPrices] = useState<Record<string, string>>({});
  const [selectedTagIds, setSelectedTagIds] = useState<string[]>([]);
  const [editingItemId, setEditingItemId] = useState<string | null>(null);
  const [scannerVisible, setScannerVisible] = useState(false);
  const [cameraReady, setCameraReady] = useState(false);
  const [lookupLoading, setLookupLoading] = useState(false);
  const [lookupMessage, setLookupMessage] = useState<string | null>(null);
  const lookupRequestId = useRef(0);
  const [tagName, setTagName] = useState('');
  const [editingTag, setEditingTag] = useState<MoneyTag | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    initializeMoneyTracker()
      .then(loadMoneyManagementData)
      .then((result) => {
        if (active) {
          setData(result);
          setError(null);
        }
      })
      .catch((caught: unknown) => {
        if (active) setError(caught instanceof Error ? caught.message : String(caught));
      });
    return () => {
      active = false;
    };
  }, [revision]);

  const categories =
    data?.categories.filter((category) => category.type === type) ?? [];
  const runWrite = async (operation: () => Promise<void>): Promise<boolean> => {
    try {
      await operation();
      setError(null);
      refresh();
      return true;
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
      return false;
    }
  };
  const inputStyle = {
    color: theme.text,
    borderColor: theme.backgroundSelected,
    backgroundColor: theme.background,
  };
  const toggle = (values: string[], id: string, setValues: (next: string[]) => void) => {
    setValues(values.includes(id) ? values.filter((value) => value !== id) : [...values, id]);
  };
  const clearItemForm = () => {
    lookupRequestId.current += 1;
    setLookupLoading(false);
    setLookupMessage(null);
    setEditingItemId(null);
    setItemName('');
    setItemBarcode('');
    setItemPrices({});
    setSelectedCategoryIds([]);
    setSelectedTagIds([]);
  };
  const saveItem = async () => {
    const name = itemName.trim();
    if (!name) {
      setError('Enter an item name.');
      return;
    }
    if (selectedCategoryIds.length === 0) {
      setError('Select at least one category.');
      return;
    }
    const rows: { categoryId: string; amountMinor: number | null }[] = [];
    for (const categoryId of selectedCategoryIds) {
      const rawAmount = itemPrices[categoryId]?.trim() ?? '';
      const amountMinor = rawAmount ? parseAmount(rawAmount, data?.currency ?? 'JPY') : null;
      if (rawAmount && amountMinor === null) {
        setError(`Enter a valid price for ${categories.find((category) => category.id === categoryId)?.name ?? 'the selected category'}.`);
        return;
      }
      rows.push({ categoryId, amountMinor });
    }
    const saved = await runWrite(() =>
      saveSharedSubcategory({
        name,
        barcode: itemBarcode,
        categories: rows,
        tagIds: selectedTagIds,
        itemId: editingItemId ?? undefined,
      }),
    );
    if (saved) clearItemForm();
  };

  const editItem = (subcategory: MoneySubcategory) => {
    lookupRequestId.current += 1;
    setLookupLoading(false);
    setLookupMessage(null);
    const digits = currencyDecimals(data?.currency ?? 'JPY');
    const links = (data?.subcategories ?? []).filter(
      (item) =>
        subcategory.item_id
          ? item.item_id === subcategory.item_id
          : item.id === subcategory.id,
    );
    const firstCategory = data?.categories.find(
      (category) => category.id === subcategory.category_id,
    );
    setType(firstCategory?.type ?? 'expense');
    setEditingItemId(subcategory.item_id);
    setItemName(subcategory.name);
    setItemBarcode(subcategory.barcode ?? '');
    setSelectedCategoryIds(links.map((link) => link.category_id));
    setItemPrices(
      Object.fromEntries(
        links.map((link) => [
          link.category_id,
          link.amount_minor == null
            ? ''
            : String(link.amount_minor / 10 ** digits),
        ]),
      ),
    );
    setSelectedTagIds(
      subcategory.item_id ? data?.itemTags[subcategory.item_id] ?? [] : [],
    );
  };

  const openBarcodeScanner = async () => {
    try {
      if (!cameraPermission?.granted) {
        const permission = await requestCameraPermission();
        if (!permission.granted) {
          setError('Camera permission is needed to scan a barcode.');
          return;
        }
      }
      scannerLocked.current = false;
      setCameraReady(false);
      setScannerVisible(true);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    }
  };

  const lookupBarcode = async (barcode: string) => {
    const requestId = ++lookupRequestId.current;
    const savedMatch = data?.subcategories.find((item) => item.barcode === barcode);
    if (savedMatch) {
      setItemName(savedMatch.name);
      setLookupMessage('Name loaded from a saved item.');
      setError(null);
      return;
    }

    setLookupLoading(true);
    setLookupMessage('Looking up product name…');
    setError(null);
    try {
      const result = await lookupFoodProductName(barcode);
      if (requestId !== lookupRequestId.current) return;
      if (result) {
        setItemName(result.name);
        setLookupMessage(
          result.brandOnly
            ? `Only the brand “${result.name}” is listed for this barcode. Add the product size or variant before saving.`
            : 'Product name found. Check it before saving.',
        );
      } else {
        setLookupMessage(
          'No name is listed for this barcode in Open Food Facts yet. Enter it manually; Japanese names are used when available.',
        );
      }
    } catch (caught) {
      if (requestId !== lookupRequestId.current) return;
      setLookupMessage('Could not look up the product. The barcode is saved; enter the name manually.');
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      if (requestId === lookupRequestId.current) setLookupLoading(false);
    }
  };

  const handleBarcodeScanned = (result: BarcodeScanningResult) => {
    if (scannerLocked.current) return;
    scannerLocked.current = true;
    const barcode = result.data.trim();
    if (!barcode) {
      scannerLocked.current = false;
      setError('Barcode not recognized. Try scanning it again.');
      return;
    }
    setItemBarcode(barcode);
    setLookupMessage(null);
    setScannerVisible(false);
    setCameraReady(false);
    scannerLocked.current = false;
    void lookupBarcode(barcode);
  };

  const closeBarcodeScanner = () => {
    scannerLocked.current = true;
    setScannerVisible(false);
    setCameraReady(false);
  };

  return (
    <Screen>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
        <Pressable accessibilityRole="button" onPress={() => router.back()}>
          <ThemedText style={{ color: theme.tint }}>Back</ThemedText>
        </Pressable>
        <ThemedText type="subtitle">Manage money tracker</ThemedText>
      </View>
      {error && <ThemedText style={{ color: theme.error }}>{error}</ThemedText>}

      <CardBlock>
        <ThemedText type="smallBold">Categories and items</ThemedText>
        <ThemedText themeColor="textSecondary">
          Items shared across categories keep one name, barcode, and tag set. Each category has
          its own price.
        </ThemedText>
        <View style={{ flexDirection: 'row', gap: 8 }}>
          {(['expense', 'income'] as const).map((value) => (
            <Pressable
              key={value}
              accessibilityRole="button"
              onPress={() => {
                setType(value);
                clearItemForm();
                setEditingCategory(null);
                setCategoryName('');
              }}
              style={{
                padding: 10,
                borderRadius: 12,
                backgroundColor: type === value ? theme.backgroundSelected : theme.background,
              }}>
              <ThemedText>{value === 'expense' ? 'Expenses' : 'Income'}</ThemedText>
            </Pressable>
          ))}
        </View>
        <TextInput
          value={categoryName}
          onChangeText={setCategoryName}
          placeholder="Category name"
          placeholderTextColor={theme.textSecondary}
          style={[styles.input, inputStyle]}
        />
        <UiButton
          label={editingCategory ? 'Save category' : 'Add category'}
          onPress={() => {
            const name = categoryName.trim();
            if (!name) {
              setError('Enter a category name.');
              return;
            }
            void runWrite(() => saveCategory(type, name, editingCategory?.id)).then((saved) => {
              if (!saved) return;
              setCategoryName('');
              setEditingCategory(null);
            });
          }}
        />
        {categories.map((category) => (
          <View key={category.id} style={styles.listRow}>
            <ThemedText style={styles.grow}>{category.name}</ThemedText>
            <Pressable
              onPress={() => {
                setEditingCategory(category);
                setCategoryName(category.name);
              }}>
              <ThemedText style={{ color: theme.tint }}>Edit</ThemedText>
            </Pressable>
            <Pressable
              onPress={() =>
                Alert.alert(
                  'Delete category?',
                  'Transactions will stay but become uncategorized.',
                  [
                    { text: 'Cancel', style: 'cancel' },
                    {
                      text: 'Delete',
                      style: 'destructive',
                      onPress: () => void runWrite(() => deleteCategory(category.id)),
                    },
                  ],
                )
              }>
              <ThemedText style={{ color: theme.error }}>Delete</ThemedText>
            </Pressable>
          </View>
        ))}
      </CardBlock>

      <CardBlock>
        <ThemedText type="smallBold">
          {editingItemId ? 'Edit shared item' : 'Add an item'}
        </ThemedText>
        <TextInput
          value={itemName}
          onChangeText={(value) => {
            lookupRequestId.current += 1;
            setLookupLoading(false);
            setItemName(value);
          }}
          placeholder="Item name"
          placeholderTextColor={theme.textSecondary}
          style={[styles.input, inputStyle]}
        />
        {lookupMessage && (
          <ThemedText type="small" themeColor="textSecondary">
            {lookupMessage}
          </ThemedText>
        )}
        <TextInput
          value={itemBarcode}
          onChangeText={setItemBarcode}
          placeholder="Barcode (optional)"
          placeholderTextColor={theme.textSecondary}
          autoCapitalize="none"
          style={[styles.input, inputStyle]}
        />
        <UiButton
          label="Scan barcode"
          variant="secondary"
          onPress={() => void openBarcodeScanner()}
        />
        {itemBarcode.trim() && (
          <UiButton
            label={lookupLoading ? 'Looking up name…' : 'Look up product name'}
            variant="secondary"
            disabled={lookupLoading}
            onPress={() => void lookupBarcode(itemBarcode.trim())}
          />
        )}
        <ThemedText type="smallBold">
          {editingItemId ? 'Categories and their prices' : 'Choose categories and set each price'}
        </ThemedText>
        {categories.map((category) => {
          const selected = selectedCategoryIds.includes(category.id);
          return (
            <View key={category.id}>
              <Pressable
                accessibilityRole="checkbox"
                accessibilityState={{ checked: selected }}
                onPress={() => {
                  toggle(selectedCategoryIds, category.id, setSelectedCategoryIds);
                }}
                style={styles.checkRow}>
                <ThemedText style={{ color: theme.tint }}>{selected ? '☑' : '☐'}</ThemedText>
                <ThemedText>{category.name}</ThemedText>
              </Pressable>
              {selected && (
                <TextInput
                  value={itemPrices[category.id] ?? ''}
                  onChangeText={(value) => setItemPrices((previous) => ({
                    ...previous,
                    [category.id]: value,
                  }))}
                  placeholder={`Price in ${data?.currency ?? 'JPY'} (optional)`}
                  placeholderTextColor={theme.textSecondary}
                  keyboardType="decimal-pad"
                  style={[styles.input, inputStyle]}
                />
              )}
            </View>
          );
        })}
        <ThemedText type="smallBold">Tags</ThemedText>
        <View style={styles.chipWrap}>
          {(data?.tags ?? []).map((tag) => {
            const selected = selectedTagIds.includes(tag.id);
            return (
              <Pressable
                key={tag.id}
                accessibilityRole="checkbox"
                accessibilityState={{ checked: selected }}
                onPress={() => toggle(selectedTagIds, tag.id, setSelectedTagIds)}
                style={[
                  styles.chip,
                  { backgroundColor: selected ? theme.backgroundSelected : theme.background },
                ]}>
                <ThemedText>{tag.name}</ThemedText>
              </Pressable>
            );
          })}
          {(data?.tags.length ?? 0) === 0 && (
            <ThemedText themeColor="textSecondary">Create tags below to assign them to items.</ThemedText>
          )}
        </View>
        <UiButton label={editingItemId ? 'Save item' : 'Add item to categories'} onPress={() => void saveItem()} />
        {editingItemId && (
          <UiButton label="Cancel editing" variant="secondary" onPress={clearItemForm} />
        )}
      </CardBlock>

      <CardBlock>
        <ThemedText type="smallBold">Existing items</ThemedText>
        {categories.map((category) => {
          const items = (data?.subcategories ?? []).filter(
            (subcategory) => subcategory.category_id === category.id,
          );
          return (
            <View key={category.id} style={styles.itemGroup}>
              <ThemedText type="smallBold">{category.name}</ThemedText>
              {items.length === 0 && (
                <ThemedText type="small" themeColor="textSecondary">No items yet.</ThemedText>
              )}
              {items.map((item) => {
                const tagNames = (data?.itemTags[item.item_id ?? ''] ?? [])
                  .map((id) => data?.tags.find((tag) => tag.id === id)?.name)
                  .filter((name): name is string => Boolean(name));
                return (
                  <View key={item.id} style={styles.itemRow}>
                    <View style={styles.grow}>
                      <ThemedText>{item.name}</ThemedText>
                      <ThemedText type="small" themeColor="textSecondary">
                        {item.amount_minor == null ? 'No fixed price' : formatMoney(item.amount_minor, data?.currency ?? 'JPY')}
                        {tagNames.length ? ` · ${tagNames.join(', ')}` : ''}
                      </ThemedText>
                    </View>
                    <Pressable onPress={() => editItem(item)}>
                      <ThemedText style={{ color: theme.tint }}>Edit</ThemedText>
                    </Pressable>
                    <Pressable
                      onPress={() =>
                        Alert.alert('Remove item from category?', 'Other category prices for this item will be kept.', [
                          { text: 'Cancel', style: 'cancel' },
                          {
                            text: 'Remove',
                            style: 'destructive',
                            onPress: () => void runWrite(() => deleteSubcategory(item.id)),
                          },
                        ])
                      }>
                      <ThemedText style={{ color: theme.error }}>Remove</ThemedText>
                    </Pressable>
                  </View>
                );
              })}
            </View>
          );
        })}
      </CardBlock>

      <CardBlock>
        <ThemedText type="smallBold">Manage tags</ThemedText>
        <TextInput
          value={tagName}
          onChangeText={setTagName}
          placeholder="Tag name"
          placeholderTextColor={theme.textSecondary}
          style={[styles.input, inputStyle]}
        />
        <UiButton
          label={editingTag ? 'Save tag' : 'Add tag'}
          onPress={() => {
            const name = tagName.trim();
            if (!name) {
              setError('Enter a tag name.');
              return;
            }
            void runWrite(() => saveMoneyTag(name, editingTag?.id)).then((saved) => {
              if (!saved) return;
              setTagName('');
              setEditingTag(null);
            });
          }}
        />
        {(data?.tags ?? []).map((tag) => (
          <View key={tag.id} style={styles.listRow}>
            <ThemedText style={styles.grow}>{tag.name}</ThemedText>
            <Pressable
              onPress={() => {
                setEditingTag(tag);
                setTagName(tag.name);
              }}>
              <ThemedText style={{ color: theme.tint }}>Edit</ThemedText>
            </Pressable>
            <Pressable
              onPress={() =>
                Alert.alert('Delete tag?', 'It will be removed from all items.', [
                  { text: 'Cancel', style: 'cancel' },
                  {
                    text: 'Delete',
                    style: 'destructive',
                    onPress: () => void runWrite(() => deleteMoneyTag(tag.id)),
                  },
                ])
              }>
              <ThemedText style={{ color: theme.error }}>Delete</ThemedText>
            </Pressable>
          </View>
        ))}
      </CardBlock>
      <Modal
        visible={scannerVisible}
        animationType="slide"
        presentationStyle="fullScreen"
        onRequestClose={closeBarcodeScanner}>
        <View style={[styles.cameraModal, { backgroundColor: '#000' }]}>
          {scannerVisible ? (
            <CameraView
              style={StyleSheet.absoluteFill}
              facing="back"
              barcodeScannerSettings={{
                barcodeTypes: ['ean13', 'ean8', 'upc_a', 'upc_e', 'code128', 'code39'],
              }}
              onCameraReady={() => setCameraReady(true)}
              onMountError={(event) => {
                closeBarcodeScanner();
                setError(`Could not start camera: ${event.message}`);
              }}
              onBarcodeScanned={handleBarcodeScanned}
            />
          ) : null}
          <View style={styles.cameraHeader}>
            <ThemedText type="subtitle" style={{ color: '#fff' }}>
              Scan item barcode
            </ThemedText>
            <Pressable accessibilityRole="button" onPress={closeBarcodeScanner}>
              <ThemedText style={{ color: '#fff' }}>Close</ThemedText>
            </Pressable>
          </View>
          <View style={styles.cameraHint}>
            <ThemedText style={{ color: '#fff', textAlign: 'center' }}>
              {cameraReady ? 'Align the barcode inside the camera view.' : 'Opening camera…'}
            </ThemedText>
          </View>
        </View>
      </Modal>
    </Screen>
  );
}

const styles = {
  input: {
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
  } as const,
  listRow: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 16,
    paddingVertical: 8,
  },
  itemRow: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 12,
    paddingVertical: 8,
  },
  itemGroup: {
    gap: 6,
    paddingTop: 8,
  },
  grow: {
    flex: 1,
  },
  checkRow: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 10,
    paddingVertical: 8,
  },
  chipWrap: {
    flexDirection: 'row' as const,
    flexWrap: 'wrap' as const,
    gap: 8,
  },
  chip: {
    borderRadius: 16,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  cameraModal: {
    flex: 1,
  },
  cameraHeader: {
    flexDirection: 'row' as const,
    justifyContent: 'space-between' as const,
    alignItems: 'center' as const,
    paddingTop: 56,
    paddingHorizontal: 20,
  },
  cameraHint: {
    position: 'absolute' as const,
    bottom: 56,
    alignSelf: 'center' as const,
    padding: 16,
  },
};
