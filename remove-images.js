import { buildApiClient } from './apiClient.js';
import csvParser from 'csv-parser';
import fs from 'fs';

const args = process.argv.slice(2);
const dryRun = args.includes('--dryRun');
const outputLogFilePath = 'output.log';
const productsCSV = './products.csv';
const ACTIONS_LIMIT = 500;

function chunkArray(array, chunkSize) {
  const chunks = [];
  for (let i = 0; i < array.length; i += chunkSize) {
    chunks.push(array.slice(i, i + chunkSize));
  }
  return chunks;
}

function readProductsFromCSV(filePath) {
  return new Promise((resolve, reject) => {
    const products = [];
    fs.createReadStream(filePath)
        .pipe(csvParser())
        .on('data', (row) => {
          products.push(row);
        })
        .on('end', () => {
          resolve(products);
        })
        .on('error', (error) => {
          reject(error);
        });
  });
}

function logToFile(message) {
  fs.appendFileSync(outputLogFilePath, message + '\n', 'utf8');
}

function pushActions(actions, variant, imageUrl) {
  actions.push({
    action: 'removeImage',
    sku: variant.sku,
    imageUrl,
  });
}

async function processImages() {
  const apiClient = buildApiClient();

  try {
    const products = await readProductsFromCSV(productsCSV);
    const actionsMap = new Map();

    for (const product of products) {
      // Assuming the CSV has headers: productKey, variantKey, imageUrl
      const { productKey, imageUrl } = product;
      const { body: productData } = await apiClient.products().withKey({ key: productKey }).get().execute();

      if (!actionsMap.has(productKey)) {
        actionsMap.set(productKey, []);
      }

      pushActions(actionsMap.get(productKey), productData.masterData.current.masterVariant, imageUrl);

      productData.masterData.current.variants.forEach((variant) => {
        const existingActions = actionsMap.get(productKey);
        const actionExists = existingActions.some(action => action.sku === variant.sku && action.imageUrl === imageUrl);

        if (!actionExists) {
          pushActions(existingActions, variant, imageUrl);
        }
      });

      // Only add a publish action if the product is already published
      if (productData.masterData.published) {
        actionsMap.get(productKey).push({ action: 'publish' });
      }

    }

    for (const [productKey, actions] of actionsMap.entries()) { //actionsMap.entries()
      const actionChunks = chunkArray(actions, ACTIONS_LIMIT);

      for (const [index, actionChunk] of actionChunks.entries()) { //
        const header = `\n${dryRun ? '[DRY RUN]' : '[LIVE]'} Product ${productKey}, Batch ${index + 1}:`;
        logToFile(header);
        actionChunk.forEach((a, i) => {
          const actionMessage = `  ${i + 1}. ${a.action} ${a.sku ? `from variant ${a.sku}` : ''}: ${a.imageUrl || ''}`;
          logToFile(actionMessage);
        });

        if (!dryRun) {
          try {
            // Fetch the current version of the product
            const { body: productData } = await apiClient.products().withKey({ key: productKey }).get().execute();

            await apiClient.products().withKey({ key: productKey }).post({
              body: {
                version: productData.version,
                actions: actionChunk,
              },
            }).execute();

            logToFile(`Successfully updated product ${productKey}, Batch ${index + 1}`);
          } catch (updateError) {
            logToFile(`Failed to update product ${productKey}, Batch ${index + 1}: ${updateError.message || updateError}`);
          }
        }
      }
    }
  } catch (err) {
    logToFile('Failed to process products: ' + (err.message || err));
  }
}

processImages().catch(err => {
  logToFile('Script failed: ' + (err.message || err));
});
