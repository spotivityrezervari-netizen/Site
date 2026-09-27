// js/db.js

// Aici extragem funcția de creare a conexiunii din biblioteca Supabase
const { createClient } = supabase;

// Datele tale reale (extrase din cheia ta!)
const supabaseUrl = 'https://ndubcdwohqzgxpuiowye.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5kdWJjZHdvaHF6Z3hwdWlvd3llIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODU1ODIxMjYsImV4cCI6MjEwMTE1ODEyNn0.in5vgHm5P87HTACR_S8SVln-_3rf_u2la8XssQoguMY';

// Creăm conexiunea globală la baza de date
const db = createClient(supabaseUrl, supabaseKey);

console.log("🚀 Conectat la Supabase cu succes!");

