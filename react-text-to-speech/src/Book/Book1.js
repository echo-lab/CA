export const data = [
  {
    Book: {
      id: 1,
      Name: "Pattern Pals: Birthday Beeps and Boops",
      Characters: [
        {Name:"Narrator", img: require("../Pictures/narrator.png")},
        {Name:"Clara",img: require("../Pictures/book1/Clara_avatar.jpg")},
        {Name:"Zoe",img: require("../Pictures/book1/Zoe_avatar.jpg")},
      ],

      Pages: {
        Cover: {
          img: require("../Pictures/book1/Cover - Birthday Beeps.jpg"),
          question: "You will see questions in this box while reading the book. Feel free to use them at your convenience.",
          text: [
            {
              Reading: false,
              Character: "Narrator",
              Dialogue:
                "The Pattern Pals: <break time='1s'/> Birthday Beeps and Boops",
            }
          ],
        },
        PageOne: {
          img: require("../Pictures/book1/Page_1.jpg"),
          question: "What is Zoe trying to do with the streamers?",
          text: [
            {
              Reading: false,
              Character: "Narrator",
              Dialogue:
                "Clara the chameleon found Zoe making a <emphasis level='strong'> BIG </emphasis> mess.",
            },
            {
              Reading: false,
              Character: "Clara",
              Dialogue:
                "“Hey, what are these decorations for?”",
            },

            {
              Reading: false,
              Character: "Narrator",
              Dialogue:
                "Clara asked.",
            },
            {
              Reading: false,
              Character: "Zoe",
              Dialogue:
                "“Ummm, a surprise party for… <break time='1s'/> uhhh… <break time='1s'/>someone,”",
            },
            {
              Reading: false,
              Character: "Narrator",
              Dialogue:
                "said Zoe.",
            },
            {
              Reading: false,
              Character: "Zoe",
              Dialogue:
                "<emphasis level='strong'>“Come help!”</emphasis>",
            },
          ],
        },

        PageTwo: {
          img: require("../Pictures/book1/Page_2.jpg"),
          question: "How would you arrange your favorite colors on a cake?",
          text: [
            {
              Reading: false,
              Character: "Zoe",
              Dialogue:
                "<emphasis level='strong'>“Let’s choose a cake!”</emphasis>",
            },
            {
              Reading: false,
              Character: "Narrator",
              Dialogue:
                "squawked Zoe.",
            },
            {
              Reading: false,
              Character: "Zoe",
              Dialogue: "“This one has the birthday girl’s favorite colors. <break time='1s'/> <emphasis level='strong'> Purple, green, purple, green!”</emphasis>",
            },
            {
              Reading: false,
              Character: "Clara",
              Dialogue: "“Those are my favorite colors, too!”",
            },
            {
              Reading: false,
              Character: "Narrator",
              Dialogue: "said Clara.",
            }, {
              Reading: false,
              Character: "Clara",
              Dialogue: "“And it’s <emphasis level='moderate'> *my* </emphasis> birthday.”",
            }
          ],
        },
        PageThree: {
          img: require("../Pictures/book1/Page_3.jpg"),
          question: "How do you think Clara is feeling?",
          text: [
            {
              Reading: false,
              Character: "Zoe",
              Dialogue:
                "“Oh… <break time='1s'/> it’s your birthday?”",
            },
            {
              Reading: false,
              Character: "Narrator",
              Dialogue:
                "Zoe turned to the streamers.",
            },
            {
              Reading: false,
              Character: "Zoe",
              Dialogue: "“Um… <break time='1s'/><emphasis level='strong'> look! </emphasis>Purple, green, purple, green!  Same as the cake!  Let’s add more!”",
            },
            {
              Reading: false,
              Character: "Narrator",
              Dialogue: "Clara hugged her tail. <break time='1s'/> Who else could the party be for?",
            },
          ],
        },
        PageFour: {
          img: require("../Pictures/book1/Page_4.jpg"),
          question: "What pattern do the streamers make?",
          text: [
            {
              Reading: false,
              Character: "Zoe",
              Dialogue:
                "<emphasis level='strong'> “A perfect pattern!”</emphasis>",
            },
            {
              Reading: false,
              Character: "Narrator",
              Dialogue:
                "Zoe said.",
            },
            {
              Reading: false,
              Character: "Zoe",
              Dialogue:
                "<epmhasis level='strong'> “The birthday girl will love it!”</emphasis>",
            },
            {
              Reading: false,
              Character: "Narrator",
              Dialogue:
                "Clara looked down. <break time='1s'/>Had Zoe really forgotten <emphasis level='strong'>*her* </emphasis> birthday?",
            },
          ],
        },
        PageFive: {
          img: require("../Pictures/book1/Page_5.jpg"),
          question: "Who do you think the party is for?",
          text: [
            {
              Reading: false,
              Character: "Clara",
              Dialogue:
                "“Can you please tell me who this party is for?”",
            },
            {
              Reading: false,
              Character: "Narrator",
              Dialogue: "Clara asked.",
            },
            {
              Reading: false,
              Character: "Zoe",
              Dialogue:
                "<emphasis level='strong'>“No time, no time!” </emphasis>",
            },
            {
              Reading: false,
              Character: "Narrator",
              Dialogue: "Zoe exclaimed.",
            },
            {
              Reading: false,
              Character: "Zoe",
              Dialogue:
                "<emphasis level='strong'> “We need more hats!” </emphasis?",
            },
          ],
        },
        PageSix: {
          img: require("../Pictures/book1/Page_6.jpg"),
          question: "Why does Clara want to leave?",
          text: [
            {
              Reading: false,
              Character: "Zoe",
              Dialogue:
                "<emphasis level='strong'> “Beep, boop, beep, boop!” </emphasis>",
            },
            {
              Reading: false,
              Character: "Narrator",
              Dialogue: "Zoe pointed at the hats.",
            },
            {
              Reading: false,
              Character: "Clara",
              Dialogue:
                " <prosody volume='-6dB' pitch='-2st'>“Maybe I should go…</prosody>” <break time ='1s'/>",
            },
            {
              Reading: false,
              Character: "Narrator",
              Dialogue: "Clara whispered, <break time = '500ms' but Zoe didn’t hear.",
            },
            {
              Reading: false,
              Character: "Zoe",
              Dialogue:
                "<emphasis level='strong'>“We need plates!”</emphasis>",
            },
            {
              Reading: false,
              Character: "Narrator",
              Dialogue:
                "Zoe fluttered excitedly.",
            },
        
          ],
        },
        PageSeven: {
          img: require("../Pictures/book1/Page_7.jpg"),
          question: "What color plate is missing?",
          text: [
            {
              Reading: false,
              Character: "Narrator",
              Dialogue:
                "Zoe set the table.",
            },
            {
              Reading: false,
              Character: "Zoe",
              Dialogue:
                "“Uh-oh,”",
            },
            {
              Reading: false,
              Character: "Narrator",
              Dialogue:
                "she cried.",
            },
            {
              Reading: false,
              Character: "Zoe",
              Dialogue:
                "<prosody volume='-2db' rate='0.7' pitch='-2st'> “I don’t know what’s missing!”</prosody>",
            },
            {
              Reading: false,
              Character: "Narrator",
              Dialogue:
                "Clara saw Zoe was upset. <break time ='1s'/> Zoe was still her best friend. <break time ='1s'/>  Clara took a deep breath.",
            },
            {
              Reading: false,
              Character: "Clara",
              Dialogue: "“I have an idea,”",
            },
            {
              Reading: false,
              Character: "Narrator",
              Dialogue:
                "offered Clara.",
            },
          ],
        },
        PageEight: {
          img: require("../Pictures/book1/Page_8.jpg"),
          question: "Tell me about the pattern Clara completed.",
          text: [
            {
              Reading: false,
              Character: "Narrator",
              Dialogue:
                "Clara changed colors.",
            },
            {
              Reading: false,
              Character: "Clara",
              Dialogue:
                "“How do I look?”",
            },
            {
              Reading: false,
              Character: "Zoe",
              Dialogue: "<emphasis level='strong'>“Great!”</emphasis>",
            },
            {
              Reading: false,
              Character: "Narrator",
              Dialogue:
                "Zoe said.",
            },
            {
              Reading: false,
              Character: "Zoe",
              Dialogue: "<emphasis level='strong'>“Beep, boop, beep, boop!” </emphasis>",
            },
            {
              Reading: false,
              Character: "Narrator",
              Dialogue: "Zoe sounded so silly that Clara started laughing.",
            },
          ],
        },
        PageNine: {
          img: require("../Pictures/book1/Page_9.jpg"),
          question: "Are there more circle or star balloons?",
          text: [
            {
              Reading: false,
              Character: "Narrator",
              Dialogue:
                "They turned to the balloons.",
            },
            {
              Reading: false,
              Character: "Zoe",
              Dialogue:
                "<emphasis level='strong'>“Wait!</emphasis> <break time ='1s' />There aren’t enough circle balloons. <break time ='1s' /> Beep, boop, beep, <emphasis level='strong'>***beep***,</emphasis> see?”",
            },
            {
              Reading: false,
              Character: "Narrator",
              Dialogue:
                "said Zoe.",
            },
            {
              Reading: false,
              Character: "Clara",
              Dialogue:
                "“Well… <break time ='1s'/> let’s make a new pattern,”",
            },
            {
              Reading: false,
              Character: "Narrator",
              Dialogue:
                "said Clara.",
            },
          ],
        },
        PageTen: {
          img: require("../Pictures/book1/Page_10.jpg"),
          question: "Which balloon is the “beep,” and which is the “boop” in the pattern?",
          text: [
            {
              Reading: false,
              Character: "Narrator",
              Dialogue:
                "Clara and Zoe moved the balloons.",
            },
            {
              Reading: false,
              Character: "Zoe",
              Dialogue:
                "<emphasis level='strong'> “Star, star, circle! Star, star, circle!” </emphasis>",
            },
            {
              Reading: false,
              Character: "Narrator",
              Dialogue:
                "shouted Zoe.",
            },
            {
              Reading: false,
              Character: "Zoe",
              Dialogue:
                "<emphasis level='strong'> “We fixed it!” </emphasis>",
            },
            {
              Reading: false,
              Character: "Clara",
              Dialogue:
                "<emphasis level='strong'>“Beep, beep, boop! Beep, beep, boop!”</emphasis>",
            },
            {
              Reading: false,
              Character: "Narrator",
              Dialogue:
                "Clara laughed.",
            },
            {
              Reading: false,
              Character: "Clara",
              Dialogue:
                "“Helping <emphasis level='strong'>**WAS**</emphasis> fun!”",
            },
          ],
        },
        PageEleven: {
          img: require("../Pictures/book1/Page_11.jpg"),
          question: "What do you think Zoe is going to show Clara?",
          text: [
            {
              Reading: false,
              Character: "Clara",
              Dialogue:
                "“The birthday girl will love this,”",
            },
            {
              Reading: false,
              Character: "Narrator",
              Dialogue:
                "Clara said.",
            },
            {
              Reading: false,
              Character: "Clara",
              Dialogue:
                "“I’m glad I could help.”",
            },
            {
              Reading: false,
              Character: "Narrator",
              Dialogue:
                "Zoe couldn’t wait any longer.",
            },
            {
              Reading: false,
              Character: "Zoe",
              Dialogue:
                "<emphasis level='strong'>“I have something to show you!”</emphasis>",
            },
            {
              Reading: false,
              Character: "Narrator",
              Dialogue:
                "she squealed.",
            },
          ],
        },
        PageTwelve: {
          img: require("../Pictures/book1/Page_12.jpg"),
          question: "How do you think Zoe would dance when she sings to Clara?",
          text: [
            {
              Reading: false,
              Character: "Narrator",
              Dialogue:
                "<emphasis level='strong'> *Boom, boom, clash! Boom, boom, clash!*</emphasis>",
            },
            {
              Reading: false,
              Character: "Zoe",
              Dialogue:
                "<emphasis level='strong'> “Happy birthday, happy birthday!”</emphasis",
            },
            {
              Reading: false,
              Character: "Narrator",
              Dialogue:
                "sang Zoe.",
            },
            {
              Reading: false,
              Character: "Zoe",
              Dialogue:
                "<emphasis level='strong'>“Happy birthday, Clara!”</emphasis>",
            },
            {
              Reading: false,
              Character: "Clara",
              Dialogue:
                "<prosody volume='+2dB' rate='1' pitch='+2st'>“For me?”</prosody>",
            },
            {
              Reading: false,
              Character: "Narrator",
              Dialogue:
                "Clara gasped.",
            },
          ],
        },
        PageThirteen: {
          img: require("../Pictures/book1/Page_13.jpg"),
          question: "What color was the cake they ordered?",
          text: [
            {
              Reading: false,
              Character: "Zoe",
              Dialogue:
                "“Of course!”",
            },
            {
              Reading: false,
              Character: "Narrator",
              Dialogue:
                "Zoe gave Clara a <emphasis level='strong'>**BIG**</emphasis> hug.",
            },
            {
              Reading: false,
              Character: "Zoe",
              Dialogue:
                "<emphasis level='strong'>“You’re my best friend!”</emphasis>",
            },
            {
              Reading: false,
              Character: "Clara",
              Dialogue:
                "<emphasis level='strong'>“Awwww! <break time ='1s'/> Thanks, Zoe!” <emphasis>",
            },
            {
              Reading: false,
              Character: "Narrator",
              Dialogue:
                "Clara beamed.",
            },
            {
              Reading: false,
              Character: "Narrator",
              Dialogue:
                "<emphasis level='strong'>*Ding dong, ding dong.*</emphasis>",
            },
            {
              Reading: false,
              Character: "Zoe",
              Dialogue:
                "“The cake’s here!”",
            },
            {
              Reading: false,
              Character: "Narrator",
              Dialogue:
                "Zoe said.",
            },
          ],
        },
        PageFourteen: {
          img: require("../Pictures/book1/Page_14.jpg"),
          question: "What do you think they will do with the cake? ",
          text: [
            {
              Reading: false,
              Character: "Narrator",
              Dialogue:
                "They threw open the cake box.",
            },
            {
              Reading: false,
              Character: "Zoe",
              Dialogue:
                "<prosody volume='-2db' rate='0.6' pitch='-2st'>“Oh no!”</prosody>",
            },
            {
              Reading: false,
              Character: "Narrator",
              Dialogue:
                "Zoe cried.",
            },
            {
              Reading: false,
              Character: "Zoe",
              Dialogue:
                "<prosody volume='-2db' rate='0.6' pitch='-2st'> “The colors don’t match the decorations. <break time ='1s'> What should we do?”</prosody>",
            },
          ],
        },
        PageFifteen: {
          img: require("../Pictures/book1/Page_15.jpg"),
          question: "How is the pattern on the cake the same as the pattern of the streamers?",
          text: [
            {
              Reading: false,
              Character: "Clara",
              Dialogue:
                "“Keep it!”",
            },
            {
              Reading: false,
              Character: "Narrator",
              Dialogue:
                "said Clara.",
            },
            {
              Reading: false,
              Character: "Clara",
              Dialogue:
                "“It matches the pattern of the streamers. Beep, boop, beep, boop—see?”",
            },
            {
              Reading: false,
              Character: "Zoe",
              Dialogue:
                "<emphasis level='strong'> “You’re right!”</emphasis>",
            },
            {
              Reading: false,
              Character: "Narrator",
              Dialogue:
                "exclaimed Zoe, taking a huge bite.",
            },
            {
              Reading: false,
              Character: "Clara",
              Dialogue:
                "<emphasis level='strong'>“*Zoe!*”</emphasis>",
            },
            {
              Reading: false,
              Character: "Narrator",
              Dialogue:
                "Clara laughed.",
            },
            {
              Reading: false,
              Character: "Clara",
              Dialogue:
                "<emphasis level='strong'>“Our friends aren’t here yet!”</emphasis>",
            },
            {
              Reading: false,
              Character: "Zoe",
              Dialogue:
                "“Mmm…”",
            },
            {
              Reading: false,
              Character: "Narrator",
              Dialogue:
                "said Zoe.",
            },
            {
              Reading: false,
              Character: "Zoe",
              Dialogue:
                "<emphasis level='strong'>“It still tastes delicious!”<emphasis>",
            },
            {
              Reading: false,
              Character: "Narrator",
              Dialogue: "The End.",
            },
          ],
        },
      },
    },
  },
];
