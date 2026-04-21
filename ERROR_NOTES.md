## 2026-03-31 - Expo push / FCM problem

### Simptom

Backend prijavljuje gresku prilikom slanja push notifikacija:

`Unable to retrieve the FCM server key for the recipient's app. Make sure you have provided a server key as directed by the Expo FCM documentation. (InvalidCredentials)`

Stack vodi do:

- `src/features/notification/expoPush.service.ts:43`
- `src/features/notification/matcher.ts:127`

### Sta je utvrdjeno

- Backend uspesno dolazi do faze slanja i prosledjuje validan Expo push token Expo servisu.
- Problem nije u matcher logici niti u samom pozivu `sendExpoPushNotification`.
- Expo vraca `InvalidCredentials`, sto znaci da za Android aplikaciju kojoj pripada primalac tokena nisu ispravno podeseni FCM kredencijali.
- U lokalnom `.env` trenutno nema `EXPO_ACCESS_TOKEN`, ali ova konkretna greska izgleda kao problem na Expo/Firebase strani projekta, ne kao lokalni backend env problem.

### Najverovatniji uzrok

- FCM V1 service account nije dodat ili nije validan u Expo/EAS projektu.
- Expo push token pripada drugom Expo projektu/account-u.
- Promenjen je Firebase projekat ili `google-services.json`, pa tokeni i kredencijali vise ne odgovaraju istom projektu.
- U bazi su ostali stari Android tokeni iz prethodne konfiguracije aplikacije.

### Dodatno primeceno u backendu

- `matcher.ts` trenutno upisuje `notificationLog` i kada slanje padne.
- `Notification` zapis ostaje sa statusom `PENDING`, pa se u logovima vidi vise pending notifikacija iako push nije realno isporucen.

### Sutra proveriti

1. U Expo/EAS projektu proveriti Android push credentials / FCM V1 service account.
2. Potvrditi da mobilna aplikacija i backend koriste isti Expo projekat.
3. Ako je menjan Firebase projekat ili app config, regenerisati Expo push token na uredjaju i po potrebi obrisati stare device tokene iz baze.
4. Patchovati backend da:
   - ne upisuje `notificationLog` kada slanje padne
   - azurira `Notification.status` na `SENT` samo kada Expo prihvati slanje
   - eventualno belezi `FAILED` status za neuspele pokusaje
